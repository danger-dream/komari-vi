package admin

import (
	"bufio"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/komari-monitor/komari/api"
	"github.com/komari-monitor/komari/database/auditlog"
	"github.com/komari-monitor/komari/database/clients"
	"github.com/komari-monitor/komari/database/credentials"
	"github.com/komari-monitor/komari/database/models"
	"golang.org/x/crypto/ssh"
	"gorm.io/gorm"
)

type sshTarget struct {
	Host         string `json:"host" binding:"required"`
	Port         int    `json:"port"`
	CredentialID uint   `json:"credential_id" binding:"required"`
}

type sshInstallSession struct {
	ID        string
	CreatedAt time.Time
	Done      bool
	Err       string

	mu   sync.Mutex
	logs []string
	subs map[chan string]struct{}
}

var (
	sshSessionsMu sync.Mutex
	sshSessions   = map[string]*sshInstallSession{}
)

func cleanupOldSSHSessionsLocked(now time.Time) {
	// 保留最近 6 小时内的 session；或仍未完成的 session
	for id, s := range sshSessions {
		s.mu.Lock()
		done := s.Done
		createdAt := s.CreatedAt
		s.mu.Unlock()
		if done && now.Sub(createdAt) > 6*time.Hour {
			delete(sshSessions, id)
		}
	}
}

func newSSHSession() *sshInstallSession {
	s := &sshInstallSession{
		ID:        uuid.NewString(),
		CreatedAt: time.Now(),
		subs:      map[chan string]struct{}{},
		logs:      make([]string, 0, 200),
	}
	sshSessionsMu.Lock()
	cleanupOldSSHSessionsLocked(s.CreatedAt)
	sshSessions[s.ID] = s
	sshSessionsMu.Unlock()
	return s
}

func getSSHSession(id string) (*sshInstallSession, bool) {
	sshSessionsMu.Lock()
	defer sshSessionsMu.Unlock()
	s, ok := sshSessions[id]
	return s, ok
}

func (s *sshInstallSession) appendLog(line string) {
	line = strings.TrimRight(line, "\r\n")
	s.mu.Lock()
	if len(s.logs) >= 2000 {
		s.logs = s.logs[len(s.logs)-1000:]
	}
	s.logs = append(s.logs, line)
	for ch := range s.subs {
		select {
		case ch <- line:
		default:
		}
	}
	s.mu.Unlock()
}

func (s *sshInstallSession) finish(err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.Done = true
	if err != nil {
		s.Err = err.Error()
	}
	for ch := range s.subs {
		close(ch)
	}
	s.subs = map[chan string]struct{}{}
}

func (s *sshInstallSession) snapshot() (logs []string, done bool, err string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	cp := make([]string, len(s.logs))
	copy(cp, s.logs)
	return cp, s.Done, s.Err
}

func (s *sshInstallSession) subscribe() chan string {
	ch := make(chan string, 100)
	s.mu.Lock()
	s.subs[ch] = struct{}{}
	s.mu.Unlock()
	return ch
}

func buildSSHClient(target sshTarget) (*ssh.Client, *models.Credential, error) {
	if target.Port <= 0 {
		target.Port = 22
	}
	cred, err := credentials.Get(target.CredentialID)
	if err != nil {
		return nil, nil, err
	}
	secret, err := credentials.RevealSecret(cred.ID)
	if err != nil {
		return nil, nil, err
	}
	passphrase, err := credentials.RevealPassphrase(cred.ID)
	if err != nil {
		return nil, nil, err
	}
	var auth ssh.AuthMethod
	switch cred.Type {
	case models.CredentialTypePassword:
		auth = ssh.Password(secret)
	case models.CredentialTypeKey:
		var signer ssh.Signer
		if strings.TrimSpace(passphrase) != "" {
			signer, err = ssh.ParsePrivateKeyWithPassphrase([]byte(secret), []byte(passphrase))
		} else {
			signer, err = ssh.ParsePrivateKey([]byte(secret))
		}
		if err != nil {
			return nil, nil, fmt.Errorf("invalid private key: %w", err)
		}
		auth = ssh.PublicKeys(signer)
	default:
		return nil, nil, fmt.Errorf("unsupported credential type: %s", cred.Type)
	}

	cfg := &ssh.ClientConfig{
		User:            cred.Username,
		Auth:            []ssh.AuthMethod{auth},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         10 * time.Second,
	}
	addr := net.JoinHostPort(target.Host, strconv.Itoa(target.Port))
	client, err := ssh.Dial("tcp", addr, cfg)
	if err != nil {
		return nil, nil, err
	}
	return client, cred, nil
}

func runSSHCommand(client *ssh.Client, cmd string, onLine func(string)) error {
	sess, err := client.NewSession()
	if err != nil {
		return err
	}
	defer sess.Close()

	stdout, err := sess.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := sess.StderrPipe()
	if err != nil {
		return err
	}

	if err := sess.Start(cmd); err != nil {
		return err
	}

	wg := sync.WaitGroup{}
	wg.Add(2)
	go func() {
		defer wg.Done()
		sc := bufio.NewScanner(stdout)
		for sc.Scan() {
			onLine(sc.Text())
		}
	}()
	go func() {
		defer wg.Done()
		sc := bufio.NewScanner(stderr)
		for sc.Scan() {
			onLine(sc.Text())
		}
	}()

	err = sess.Wait()
	wg.Wait()
	return err
}

func TestSSHConnection(c *gin.Context) {
	var req struct {
		Target sshTarget `json:"target" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		api.RespondError(c, http.StatusBadRequest, "请求格式错误: "+err.Error())
		return
	}
	client, _, err := buildSSHClient(req.Target)
	if err != nil {
		api.RespondError(c, http.StatusBadRequest, "SSH 连接失败: "+err.Error())
		return
	}
	defer client.Close()

	// 仅支持 root
	checkCmd := "id -u"
	var out strings.Builder
	err = runSSHCommand(client, checkCmd, func(line string) {
		out.WriteString(line)
	})
	if err != nil {
		api.RespondError(c, http.StatusBadRequest, "SSH 检测失败: "+err.Error())
		return
	}
	if strings.TrimSpace(out.String()) != "0" {
		api.RespondError(c, http.StatusBadRequest, "仅支持 root 用户连接（id -u != 0）")
		return
	}

	userUUID, _ := c.Get("uuid")
	auditlog.Log(c.ClientIP(), userUUID.(string), "ssh test:"+req.Target.Host, "info")
	api.RespondSuccess(c, gin.H{"ok": true})
}

func StartSSHInstall(c *gin.Context) {
	var req struct {
		ClientUUID string    `json:"client_uuid" binding:"required"`
		Endpoint   string    `json:"endpoint" binding:"required"`
		Target     sshTarget `json:"target" binding:"required"`
		Command    string    `json:"command"`
		Options    struct {
			DisableWebSsh    bool   `json:"disable_web_ssh"`
			DisableAutoUpdate bool  `json:"disable_auto_update"`
			IgnoreUnsafeCert bool   `json:"ignore_unsafe_cert"`
			InstallGhproxy   string `json:"install_ghproxy"`
			InstallDir       string `json:"install_dir"`
			ServiceName      string `json:"install_service_name"`
			InstallVersion   string `json:"install_version"`
		} `json:"options"`
	} 
	if err := c.ShouldBindJSON(&req); err != nil {
		api.RespondError(c, http.StatusBadRequest, "请求格式错误: "+err.Error())
		return
	}

	token, err := clients.GetClientTokenByUUID(req.ClientUUID)
	if err != nil {
		api.RespondError(c, http.StatusBadRequest, "节点不存在或无效 UUID")
		return
	}

	endpoint := strings.TrimSpace(req.Endpoint)
	endpoint = strings.TrimRight(endpoint, "/")
	if endpoint == "" {
		api.RespondError(c, http.StatusBadRequest, "endpoint 不能为空")
		return
	}

	s := newSSHSession()
	userUUID, _ := c.Get("uuid")
	auditlog.Log(c.ClientIP(), userUUID.(string), "ssh install start:"+req.ClientUUID, "warn")

	go func() {
		defer func() {
			// 防止 panic 中断
			if r := recover(); r != nil {
				s.finish(fmt.Errorf("panic: %v", r))
			}
		}()

		client, cred, err := buildSSHClient(req.Target)
		if err != nil {
			s.appendLog("[ERROR] SSH 连接失败: " + err.Error())
			s.finish(err)
			return
		}
		defer client.Close()

		s.appendLog(fmt.Sprintf("[INFO] Connected: %s@%s:%d", cred.Username, req.Target.Host, req.Target.Port))

		// 仅支持 root
		var uidOut strings.Builder
		if err := runSSHCommand(client, "id -u", func(line string) { uidOut.WriteString(line) }); err != nil {
			s.appendLog("[ERROR] id -u failed: " + err.Error())
			s.finish(err)
			return
		}
		if strings.TrimSpace(uidOut.String()) != "0" {
			err := fmt.Errorf("only root supported")
			s.appendLog("[ERROR] Only root supported (id -u != 0)")
			s.finish(err)
			return
		}

		customCmd := strings.TrimSpace(req.Command)
		cmd := ""
		if customCmd != "" {
			cmd = customCmd
		} else {
			args := []string{
				"-e", endpoint,
				"-t", token,
			}
			if req.Options.DisableWebSsh {
				args = append(args, "--disable-web-ssh")
			}
			if req.Options.DisableAutoUpdate {
				args = append(args, "--disable-auto-update")
			}
			if req.Options.IgnoreUnsafeCert {
				args = append(args, "--ignore-unsafe-cert")
			}
			if strings.TrimSpace(req.Options.InstallGhproxy) != "" {
				args = append(args, "--install-ghproxy", strings.TrimSpace(req.Options.InstallGhproxy))
			}
			if strings.TrimSpace(req.Options.InstallDir) != "" {
				args = append(args, "--install-dir", strings.TrimSpace(req.Options.InstallDir))
			}
			if strings.TrimSpace(req.Options.ServiceName) != "" {
				args = append(args, "--install-service-name", strings.TrimSpace(req.Options.ServiceName))
			}
			if strings.TrimSpace(req.Options.InstallVersion) != "" {
				args = append(args, "--install-version", strings.TrimSpace(req.Options.InstallVersion))
			}

			// 通过面板脚本执行安装（依赖远端可访问面板）
			cmd = fmt.Sprintf("bash <(curl -fsSL %s/api/public/install.sh) %s", endpoint, shellQuoteArgs(args))
		}
		s.appendLog("[INFO] Running: " + cmd)
		err = runSSHCommand(client, cmd, func(line string) {
			s.appendLog(line)
		})
		if err != nil {
			s.appendLog("[ERROR] Install command failed: " + err.Error())
			s.finish(err)
			return
		}
		s.appendLog("[SUCCESS] Install finished")

		// 记录 SSH 配置到节点（忽略 HostKey 默认 true）
		_ = clients.SaveClient(map[string]interface{}{
			"uuid":                req.ClientUUID,
			"ssh_enabled":         true,
			"ssh_host":            req.Target.Host,
			"ssh_port":            req.Target.Port,
			"ssh_credential_id":   req.Target.CredentialID,
			"ssh_ignore_host_key": true,
		})

		s.finish(nil)
	}()

	api.RespondSuccess(c, gin.H{"session_id": s.ID})
}

func StreamSSHInstall(c *gin.Context) {
	id := c.Param("id")
	s, ok := getSSHSession(id)
	if !ok {
		api.RespondError(c, http.StatusNotFound, "session not found")
		return
	}

	c.Writer.Header().Set("Content-Type", "text/event-stream")
	c.Writer.Header().Set("Cache-Control", "no-cache")
	c.Writer.Header().Set("Connection", "keep-alive")

	// 先发历史
	logs, done, errStr := s.snapshot()
	for _, line := range logs {
		fmt.Fprintf(c.Writer, "data: %s\n\n", sseEscape(line))
	}
	c.Writer.Flush()
	if done {
		fmt.Fprintf(c.Writer, "event: done\ndata: %s\n\n", sseEscape(errStr))
		c.Writer.Flush()
		return
	}

	ch := s.subscribe()
	defer func() {
		// 订阅在 finish 时会被 close，这里无需额外处理
	}()

	notify := c.Request.Context().Done()
	for {
		select {
		case <-notify:
			return
		case line, ok := <-ch:
			if !ok {
				_, done, errStr := s.snapshot()
				if done {
					fmt.Fprintf(c.Writer, "event: done\ndata: %s\n\n", sseEscape(errStr))
					c.Writer.Flush()
				}
				return
			}
			fmt.Fprintf(c.Writer, "data: %s\n\n", sseEscape(line))
			c.Writer.Flush()
		}
	}
}

func GetSSHInstallStatus(c *gin.Context) {
	id := c.Param("id")
	s, ok := getSSHSession(id)
	if !ok {
		api.RespondError(c, http.StatusNotFound, "session not found")
		return
	}
	_, done, errStr := s.snapshot()
	api.RespondSuccess(c, gin.H{"done": done, "error": errStr})
}

func sseEscape(s string) string {
	// SSE 每行以 data: 开头，这里只需避免出现 \r
	return strings.ReplaceAll(s, "\r", "")
}

func shellQuoteArgs(args []string) string {
	quoted := make([]string, 0, len(args))
	for _, a := range args {
		quoted = append(quoted, shellQuote(a))
	}
	return strings.Join(quoted, " ")
}

func shellQuote(s string) string {
	// 单引号安全引用：' -> '\'' 
	if s == "" {
		return "''"
	}
	if !strings.ContainsAny(s, " \t\n'\"\\$`") {
		return s
	}
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

func IsSSHErrNotFound(err error) bool {
	return errors.Is(err, gorm.ErrRecordNotFound)
}
