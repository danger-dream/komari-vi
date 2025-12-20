package api

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"math/rand"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/komari-monitor/komari/database/clients"
	"github.com/komari-monitor/komari/database/lg"
	"github.com/komari-monitor/komari/database/models"
	"github.com/komari-monitor/komari/database/security"
	"github.com/komari-monitor/komari/utils"
	"github.com/komari-monitor/komari/ws"
)

type simpleRateLimiter struct {
	count   int
	expires time.Time
}

type nonceRecord struct {
	expires time.Time
}

type ipFail struct {
	count      int
	expires    time.Time
	lockedTill time.Time
}

var (
	lgRateMu  sync.Mutex
	lgRateMap = make(map[string]*simpleRateLimiter)
	nonceMu   sync.Mutex
	nonceMap  = make(map[string]nonceRecord)
	ipFailMu  sync.Mutex
	ipFailMap = make(map[string]*ipFail)
)

func lgRateLimit(c *gin.Context, key string, limit int, window time.Duration) bool {
	if limit <= 0 {
		return true
	}
	ip := c.ClientIP()
	if ip == "" {
		ip = "unknown"
	}
	k := key + ":" + ip
	now := time.Now()

	lgRateMu.Lock()
	defer lgRateMu.Unlock()

	for k1, v := range lgRateMap {
		if now.After(v.expires) {
			delete(lgRateMap, k1)
		}
	}

	entry, ok := lgRateMap[k]
	if !ok || now.After(entry.expires) {
		lgRateMap[k] = &simpleRateLimiter{
			count:   1,
			expires: now.Add(window),
		}
		return true
	}

	if entry.count >= limit {
		return false
	}
	entry.count++
	return true
}

func isIPLocked(ip string) (bool, time.Time) {
	ipFailMu.Lock()
	defer ipFailMu.Unlock()
	info, ok := ipFailMap[ip]
	if !ok {
		return false, time.Time{}
	}
	now := time.Now()
	if info.lockedTill.After(now) {
		return true, info.lockedTill
	}
	if info.expires.Before(now) && (info.lockedTill.IsZero() || info.lockedTill.Before(now)) {
		delete(ipFailMap, ip)
		return false, time.Time{}
	}
	return false, time.Time{}
}

func markFailure(ip string, cfg *models.SecurityConfig) {
	if cfg.MaxFailuresPerIP <= 0 {
		return
	}
	ipFailMu.Lock()
	defer ipFailMu.Unlock()
	now := time.Now()
	entry, ok := ipFailMap[ip]
	if !ok || now.After(entry.expires) {
		entry = &ipFail{}
	}
	entry.count++
	entry.expires = now.Add(time.Duration(cfg.FailureWindowSecond) * time.Second)
	if entry.count >= cfg.MaxFailuresPerIP && cfg.FailureLockMinutes > 0 {
		entry.lockedTill = now.Add(time.Duration(cfg.FailureLockMinutes) * time.Minute)
		entry.count = 0
	}
	ipFailMap[ip] = entry
}

func resetFailures(ip string) {
	ipFailMu.Lock()
	defer ipFailMu.Unlock()
	delete(ipFailMap, ip)
}

func checkNonce(cfg *models.SecurityConfig, nonce string) bool {
	if cfg.NonceTTL <= 0 {
		return true
	}
	now := time.Now()
	nonceMu.Lock()
	defer nonceMu.Unlock()
	if rec, ok := nonceMap[nonce]; ok {
		if rec.expires.After(now) {
			return false
		}
	}
	if len(nonceMap) >= cfg.NonceCacheSize && cfg.NonceCacheSize > 0 {
		// 清理过期项
		cleaned := false
		for k, v := range nonceMap {
			if now.After(v.expires) {
				delete(nonceMap, k)
				cleaned = true
			}
		}
		if !cleaned && len(nonceMap) >= cfg.NonceCacheSize {
			return false
		}
	}
	nonceMap[nonce] = nonceRecord{expires: now.Add(time.Duration(cfg.NonceTTL) * time.Second)}
	return true
}

type lgNodeView struct {
	UUID   string `json:"uuid"`
	Name   string `json:"name"`
	Region string `json:"region"`
	OS     string `json:"os"`
	IPv4   string `json:"ipv4"`
	IPv6   string `json:"ipv6"`
}

func toNodeView(node models.Client) lgNodeView {
	return lgNodeView{
		UUID:   node.UUID,
		Name:   node.Name,
		Region: node.Region,
		OS:     node.OS,
		IPv4:   node.IPv4,
		IPv6:   node.IPv6,
	}
}

func checkOriginAllowed(cfg *models.SecurityConfig, c *gin.Context) bool {
	if !cfg.RequireOrigin {
		return true
	}
	origin := c.GetHeader("Origin")
	ref := c.GetHeader("Referer")
	checks := append([]string{}, cfg.AllowedOrigins...)
	checks = append(checks, cfg.AllowedReferers...)
	if len(checks) == 0 {
		return false
	}
	for _, allowed := range checks {
		allowed = strings.TrimSpace(allowed)
		if allowed == "" {
			continue
		}
		if origin != "" && (origin == allowed || strings.HasPrefix(origin, allowed+"/")) {
			return true
		}
		if ref != "" && (ref == allowed || strings.HasPrefix(ref, allowed+"/")) {
			return true
		}
	}
	return false
}

func verifySignature(cfg *models.SecurityConfig, payload string, c *gin.Context) error {
	if !cfg.SignatureEnabled {
		return nil
	}
	tsStr := c.GetHeader("X-Lg-Ts")
	if tsStr == "" {
		tsStr = c.Query("ts")
	}
	nonce := c.GetHeader("X-Lg-Nonce")
	if nonce == "" {
		nonce = c.Query("nonce")
	}
	sig := c.GetHeader("X-Lg-Signature")
	if sig == "" {
		sig = c.Query("sig")
	}
	if tsStr == "" || nonce == "" || sig == "" {
		return fmt.Errorf("缺少签名头")
	}
	ts, err := strconv.ParseInt(tsStr, 10, 64)
	if err != nil {
		return fmt.Errorf("签名时间戳无效")
	}
	now := time.Now().Unix()
	diff := now - ts
	if diff < 0 {
		diff = -diff
	}
	if diff > int64(cfg.SignatureTTL) {
		return fmt.Errorf("签名已过期")
	}
	if !checkNonce(cfg, nonce) {
		return fmt.Errorf("请求重复或过期")
	}
	mac := hmac.New(sha256.New, []byte(cfg.SignatureSecret))
	mac.Write([]byte(tsStr))
	mac.Write([]byte("\n"))
	mac.Write([]byte(nonce))
	mac.Write([]byte("\n"))
	mac.Write([]byte(payload))
	expect := hex.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(strings.ToLower(expect)), []byte(strings.ToLower(sig))) {
		return fmt.Errorf("签名校验失败")
	}
	return nil
}

// GET /api/lg/public-nodes
func GetPublicLgNodes(c *gin.Context) {
	cfg, err := security.GetSecurityConfig()
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "安全配置加载失败")
		return
	}
	if locked, until := isIPLocked(c.ClientIP()); locked {
		RespondError(c, http.StatusTooManyRequests, fmt.Sprintf("请求已被暂时限制，请在 %s 后再试", until.Format(time.RFC3339)))
		return
	}
	if !lgRateLimit(c, "public_nodes", cfg.RatePublicPerMin, time.Minute) {
		RespondError(c, http.StatusTooManyRequests, "请求过于频繁，请稍后再试")
		return
	}
	if !checkOriginAllowed(cfg, c) {
		RespondError(c, http.StatusForbidden, "来源不被允许")
		return
	}
	items, err := lg.ListPublicAvailableNodes()
	if err != nil {
		RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}
	type respItem struct {
		AuthID        uint              `json:"auth_id"`
		AuthName      string            `json:"auth_name"`
		Node          lgNodeView        `json:"node"`
		Tools         []string          `json:"tools"`
		ExpiresAt     *models.LocalTime `json:"expires_at"`
		MaxUsage      *int              `json:"max_usage"`
		UsedCount     int               `json:"used_count"`
		RemainingUses *int              `json:"remaining_uses"`
	}
	resp := make([]respItem, 0, len(items))
	for _, it := range items {
		resp = append(resp, respItem{
			AuthID:        it.AuthID,
			AuthName:      it.AuthName,
			Node:          toNodeView(it.Node),
			Tools:         it.Tools,
			ExpiresAt:     it.ExpiresAt,
			MaxUsage:      it.MaxUsage,
			UsedCount:     it.UsedCount,
			RemainingUses: it.RemainingUses,
		})
	}
	RespondSuccess(c, resp)
}

// POST /api/lg/verify-code
func VerifyLgCode(c *gin.Context) {
	cfg, err := security.GetSecurityConfig()
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "安全配置加载失败")
		return
	}
	if locked, until := isIPLocked(c.ClientIP()); locked {
		RespondError(c, http.StatusTooManyRequests, fmt.Sprintf("请求已被暂时限制，请在 %s 后再试", until.Format(time.RFC3339)))
		return
	}
	if !lgRateLimit(c, "verify_code", cfg.RateVerifyPerMin, time.Minute) {
		RespondError(c, http.StatusTooManyRequests, "请求过于频繁，请稍后再试")
		return
	}
	if !checkOriginAllowed(cfg, c) {
		markFailure(c.ClientIP(), cfg)
		RespondError(c, http.StatusForbidden, "来源不被允许")
		return
	}
	var req struct {
		Code string `json:"code"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Code) == "" {
		RespondError(c, http.StatusBadRequest, "缺少授权码")
		return
	}
	code := strings.TrimSpace(req.Code)
	if err := verifySignature(cfg, code, c); err != nil {
		markFailure(c.ClientIP(), cfg)
		RespondError(c, http.StatusBadRequest, err.Error())
		return
	}
	nodes, auth, err := lg.VerifyCode(code)
	if err != nil {
		markFailure(c.ClientIP(), cfg)
		RespondError(c, http.StatusBadRequest, err.Error())
		return
	}
	resetFailures(c.ClientIP())
	type respItem struct {
		AuthID        uint              `json:"auth_id"`
		AuthName      string            `json:"auth_name"`
		Node          lgNodeView        `json:"node"`
		Tools         []string          `json:"tools"`
		ExpiresAt     *models.LocalTime `json:"expires_at"`
		MaxUsage      *int              `json:"max_usage"`
		UsedCount     int               `json:"used_count"`
		RemainingUses *int              `json:"remaining_uses"`
	}
	resp := make([]respItem, 0, len(nodes))
	for _, it := range nodes {
		resp = append(resp, respItem{
			AuthID:        it.AuthID,
			AuthName:      auth.Name,
			Node:          toNodeView(it.Node),
			Tools:         it.Tools,
			ExpiresAt:     it.ExpiresAt,
			MaxUsage:      it.MaxUsage,
			UsedCount:     it.UsedCount,
			RemainingUses: it.RemainingUses,
		})
	}
	RespondSuccess(c, gin.H{
		"auth": gin.H{
			"id":    auth.ID,
			"name":  auth.Name,
			"mode":  auth.Mode,
			"tools": auth.Tools,
		},
		"nodes": resp,
	})
}

// POST /api/lg/session/start
func StartLgSession(c *gin.Context) {
	cfg, err := security.GetSecurityConfig()
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "安全配置加载失败")
		return
	}
	if locked, until := isIPLocked(c.ClientIP()); locked {
		RespondError(c, http.StatusTooManyRequests, fmt.Sprintf("请求已被暂时限制，请在 %s 后再试", until.Format(time.RFC3339)))
		return
	}
	if !lgRateLimit(c, "start_session", cfg.RateStartPerMin, time.Minute) {
		RespondError(c, http.StatusTooManyRequests, "请求过于频繁，请稍后再试")
		return
	}
	if !checkOriginAllowed(cfg, c) {
		markFailure(c.ClientIP(), cfg)
		RespondError(c, http.StatusForbidden, "来源不被允许")
		return
	}
	var req struct {
		UUID   string `json:"uuid" binding:"required"`
		Tool   string `json:"tool" binding:"required"`
		Input  string `json:"input"`
		AuthID uint   `json:"auth_id" binding:"required"`
		Mode   string `json:"mode"`
		Code   string `json:"code"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		RespondError(c, http.StatusBadRequest, "参数错误")
		return
	}
	userUUID := ""
	req.Tool = strings.ToLower(req.Tool)
	req.Mode = strings.ToLower(req.Mode)
	if err := lg.ValidateTool(req.Tool); err != nil {
		RespondError(c, http.StatusBadRequest, err.Error())
		return
	}
	validatedInput, err := lg.ValidateToolInput(req.Tool, req.Input)
	if err != nil {
		RespondError(c, http.StatusBadRequest, err.Error())
		return
	}
	req.Input = validatedInput

	node, err := clients.GetClientByUUID(req.UUID)
	if err != nil {
		RespondError(c, http.StatusBadRequest, "节点不存在")
		return
	}
	if node.OS == "" || !strings.Contains(strings.ToLower(node.OS), "linux") {
		RespondError(c, http.StatusBadRequest, "仅支持 Linux 节点")
		return
	}

	auth, err := lg.GetAuthorizationByID(req.AuthID)
	if err != nil {
		RespondError(c, http.StatusBadRequest, "授权不存在")
		return
	}

	// 权限校验
	if strings.ToLower(auth.Mode) == "code" {
		req.Code = strings.TrimSpace(req.Code)
		if req.Code == "" {
			RespondError(c, http.StatusBadRequest, "需要提供授权码")
			return
		}
		if auth.Code != req.Code {
			markFailure(c.ClientIP(), cfg)
			RespondError(c, http.StatusBadRequest, "授权码不匹配")
			return
		}
	} else {
		// public
		req.Code = ""
	}

	if strings.ToLower(auth.Mode) == "code" && cfg.SignatureEnabled {
		payload := strings.Join([]string{
			strings.TrimSpace(req.UUID),
			strings.ToLower(strings.TrimSpace(req.Tool)),
			strconv.FormatUint(uint64(req.AuthID), 10),
			strings.TrimSpace(req.Code),
			strings.TrimSpace(req.Input),
		}, "\n")
		if err := verifySignature(cfg, payload, c); err != nil {
			markFailure(c.ClientIP(), cfg)
			RespondError(c, http.StatusBadRequest, err.Error())
			return
		}
	}

	// agent 在线
	if ws.GetConnectedClients()[req.UUID] == nil {
		RespondError(c, http.StatusBadRequest, "节点不在线")
		return
	}

	var authUsed *models.LgAuthorization
	if strings.ToLower(auth.Mode) == "code" {
		authUsed, err = lg.ConsumeAuthorizationByCode(req.Code, req.UUID, req.Tool)
		if err != nil {
			markFailure(c.ClientIP(), cfg)
			RespondError(c, http.StatusBadRequest, err.Error())
			return
		}
	} else {
		if !lg.ContainsNode(auth, req.UUID) {
			RespondError(c, http.StatusForbidden, "该节点不在授权范围")
			return
		}
		if !lg.AllowsTool(auth, req.Tool) {
			RespondError(c, http.StatusForbidden, "该授权不允许此工具")
			return
		}
		authUsed, err = lg.ConsumeAuthorization(auth.ID, strings.TrimSpace(req.Code))
		if err != nil {
			RespondError(c, http.StatusBadRequest, err.Error())
			return
		}
	}
	resetFailures(c.ClientIP())

	setting, err := lg.GetToolSetting(req.Tool)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "工具配置缺失")
		return
	}

	timeout := setting.TimeoutSeconds
	if timeout <= 0 {
		timeout = 30
	}

	rawInput := strings.TrimSpace(req.Input)
	sessionID := utils.GenerateRandomString(32)
	cmd := setting.CommandTemplate
	displayPort := 0
	displayIP := ""
	if req.Tool == "iperf3" {
		// 生成端口
		rand.Seed(time.Now().UnixNano())
		displayPort = rand.Intn(40000-20000) + 20000
		displayIP = node.IPv4
		if displayIP == "" {
			displayIP = node.IPv6
		}
		cmd = strings.ReplaceAll(cmd, "$PORT", strconv.Itoa(displayPort))
	}
	cmd = strings.ReplaceAll(cmd, "$INPUT", rawInput)
	session := &LgSession{
		ID:          sessionID,
		UUID:        req.UUID,
		UserUUID:    userUUID,
		Browser:     nil,
		Agent:       nil,
		RequesterIp: c.ClientIP(),
		Tool:        req.Tool,
		Input:       req.Input,
		AuthID:      authUsed.ID,
		Mode:        authUsed.Mode,
		Code:        req.Code,
		Timeout:     timeout,
		Command:     cmd,
		DisplayIP:   displayIP,
		DisplayPort: displayPort,
		AllowStop:   true,
	}

	LgSessionsMutex.Lock()
	LgSessions[sessionID] = session
	LgSessionsMutex.Unlock()

	// 通知 Agent
	if client := ws.GetConnectedClients()[req.UUID]; client != nil {
		if err := client.WriteJSON(gin.H{
			"message":       "lg",
			"request_id":    sessionID,
			"lg_request_id": sessionID,
		}); err != nil {
			RespondError(c, http.StatusBadRequest, "无法通知节点")
			LgSessionsMutex.Lock()
			delete(LgSessions, sessionID)
			LgSessionsMutex.Unlock()
			return
		}
	} else {
		RespondError(c, http.StatusBadRequest, "节点不在线")
		return
	}

	RespondSuccess(c, gin.H{
		"session_id": sessionID,
		"command":    cmd,
		"timeout":    timeout,
		"ip":         displayIP,
		"port":       displayPort,
	})
}

// Browser WS: /api/lg/session/ws?id=
func LgBrowserWS(c *gin.Context) {
	cfg, err := security.GetSecurityConfig()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"status": "error", "message": "安全配置加载失败"})
		return
	}
	if locked, until := isIPLocked(c.ClientIP()); locked {
		c.JSON(http.StatusTooManyRequests, gin.H{"status": "error", "message": fmt.Sprintf("请求已被暂时限制，请在 %s 后再试", until.Format(time.RFC3339))})
		return
	}
	if !lgRateLimit(c, "ws_connect", cfg.RateStartPerMin, time.Minute) {
		c.JSON(http.StatusTooManyRequests, gin.H{"status": "error", "message": "请求过于频繁，请稍后再试"})
		return
	}
	if !checkOriginAllowed(cfg, c) {
		markFailure(c.ClientIP(), cfg)
		c.JSON(http.StatusForbidden, gin.H{"status": "error", "message": "来源不被允许"})
		return
	}
	sessionID := c.Query("id")
	if sessionID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"status": "error", "message": "缺少会话ID"})
		return
	}
	session, ok := func() (*LgSession, bool) {
		LgSessionsMutex.Lock()
		defer LgSessionsMutex.Unlock()
		s, exists := LgSessions[sessionID]
		return s, exists
	}()
	if !ok || session == nil {
		c.JSON(http.StatusNotFound, gin.H{"status": "error", "message": "会话不存在"})
		return
	}

	if session.RequesterIp != "" && session.RequesterIp != c.ClientIP() {
		markFailure(c.ClientIP(), cfg)
		c.JSON(http.StatusForbidden, gin.H{"status": "error", "message": "来源 IP 不匹配"})
		return
	}

	if cfg.SignatureEnabled {
		if err := verifySignature(cfg, sessionID, c); err != nil {
			markFailure(c.ClientIP(), cfg)
			c.JSON(http.StatusBadRequest, gin.H{"status": "error", "message": err.Error()})
			return
		}
	}

	conn, err := ws.UpgradeRequest(c, ws.CheckOrigin)
	if err != nil {
		return
	}
	LgSessionsMutex.Lock()
	session.Browser = conn
	LgSessionsMutex.Unlock()
	conn.SetCloseHandler(func(code int, text string) error {
		LgSessionsMutex.Lock()
		delete(LgSessions, sessionID)
		LgSessionsMutex.Unlock()
		if session.Agent != nil {
			session.Agent.Close()
		}
		return nil
	})

	// 如果 Agent 已连接，则开始桥接
	go ForwardLg(sessionID)
	resetFailures(c.ClientIP())
}
