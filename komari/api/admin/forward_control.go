package admin

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/komari-monitor/komari/api"
	"github.com/komari-monitor/komari/database/clients"
	dbforward "github.com/komari-monitor/komari/database/forward"
	"github.com/komari-monitor/komari/database/models"
	"github.com/komari-monitor/komari/forward"
)

type checkPortReq struct {
	NodeID      string `json:"node_id" binding:"required"`
	PortSpec    string `json:"port_spec" binding:"required"`
	Excluded    []int  `json:"excluded_ports"`
	TimeoutSecs int    `json:"timeout"`
}

// CheckPort 调用 Agent 进行端口检测
func CheckPort(c *gin.Context) {
	var req checkPortReq
	if err := c.ShouldBindJSON(&req); err != nil {
		api.RespondError(c, http.StatusBadRequest, err.Error())
		return
	}
	timeout := time.Duration(req.TimeoutSecs) * time.Second
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	resp, err := forward.SendTaskToNode(req.NodeID, forward.TaskCheckPort, forward.CheckPortRequest{
		PortSpec:      req.PortSpec,
		ExcludedPorts: req.Excluded,
	}, timeout)
	if err != nil && resp.Message == "" {
		resp.Message = err.Error()
	}
	api.RespondSuccess(c, resp)
}

// StartForward 启动规则（入口+相关节点），当前实现直连/中继组/链式
func StartForward(c *gin.Context) {
	id, err := api.GetUintParam(c, "id")
	if err != nil {
		api.RespondError(c, http.StatusBadRequest, err.Error())
		return
	}
	rule, err := dbforward.GetForwardRule(id)
	if err != nil {
		api.RespondError(c, http.StatusNotFound, err.Error())
		return
	}
	template, err := dbforward.GetRealmConfigTemplate()
	if err != nil {
		api.RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}
	settings, err := dbforward.GetSystemSettings()
	if err != nil {
		api.RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}

	cfgs, err := forward.GenerateRealmConfigs(*rule, template.TemplateToml, resolveNodeIP)
	if err != nil {
		api.RespondError(c, http.StatusBadRequest, fmt.Sprintf("config generate failed: %v", err))
		return
	}
	var rc forward.RuleConfig
	_ = json.Unmarshal([]byte(rule.ConfigJSON), &rc)
	if entryCfg, ok := cfgs[rc.EntryNodeID]; ok && entryCfg != "" {
		_ = dbforward.UpdateForwardRule(rule.ID, map[string]interface{}{"realm_config": entryCfg})
	}

	targets := collectNodes(rule)
	results := make([]forward.AgentTaskResult, 0, len(targets))
		for nodeID, startReq := range buildStartRequests(rule, cfgs, settings.StatsReportInterval, settings.HealthCheckInterval, settings.RealmCrashRestartLimit, settings.ProcessStopTimeout, template.TemplateToml) {
		res, err := forward.SendTaskToNode(nodeID, forward.TaskStartRealm, startReq, 20*time.Second)
		if err != nil && res.Message == "" {
			res.Message = err.Error()
		}
		results = append(results, res)
	}

	_ = dbforward.UpdateForwardRule(rule.ID, map[string]interface{}{"status": "running"})
	api.RespondSuccess(c, results)
}

// StopForward 停止规则相关节点
func StopForward(c *gin.Context) {
	id, err := api.GetUintParam(c, "id")
	if err != nil {
		api.RespondError(c, http.StatusBadRequest, err.Error())
		return
	}
	rule, err := dbforward.GetForwardRule(id)
	if err != nil {
		api.RespondError(c, http.StatusNotFound, err.Error())
		return
	}
	settings, err := dbforward.GetSystemSettings()
	if err != nil {
		api.RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}
	var rc forward.RuleConfig
	_ = json.Unmarshal([]byte(rule.ConfigJSON), &rc)
	protocol := strings.TrimSpace(rc.Protocol)
	if protocol == "" {
		protocol = "tcp"
	}
	results := make([]forward.AgentTaskResult, 0)
	for nodeID, port := range collectNodePorts(rule) {
		req := forward.StopRealmRequest{
			RuleID: rule.ID,
			NodeID: nodeID,
			Protocol: protocol,
			Port:   port,
			Timeout: settings.ProcessStopTimeout,
		}
		res, err := forward.SendTaskToNode(nodeID, forward.TaskStopRealm, req, 10*time.Second)
		if err != nil && res.Message == "" {
			res.Message = err.Error()
		}
		results = append(results, res)
	}
	_ = dbforward.UpdateForwardRule(rule.ID, map[string]interface{}{"status": "stopped"})
	api.RespondSuccess(c, results)
}

// ApplyForwardConfigs 批量下发配置（仅用于运行中规则）
func ApplyForwardConfigs(c *gin.Context) {
	id, err := api.GetUintParam(c, "id")
	if err != nil {
		api.RespondError(c, http.StatusBadRequest, err.Error())
		return
	}
	rule, err := dbforward.GetForwardRule(id)
	if err != nil {
		api.RespondError(c, http.StatusNotFound, err.Error())
		return
	}
	if strings.ToLower(rule.Status) != "running" {
		api.RespondError(c, http.StatusBadRequest, "rule not running")
		return
	}
	template, err := dbforward.GetRealmConfigTemplate()
	if err != nil {
		api.RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}
	settings, err := dbforward.GetSystemSettings()
	if err != nil {
		api.RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}
	cfgs, err := forward.GenerateRealmConfigs(*rule, template.TemplateToml, resolveNodeIP)
	if err != nil {
		api.RespondError(c, http.StatusBadRequest, fmt.Sprintf("config generate failed: %v", err))
		return
	}
	var rc forward.RuleConfig
	_ = json.Unmarshal([]byte(rule.ConfigJSON), &rc)
	if entryCfg, ok := cfgs[rc.EntryNodeID]; ok && entryCfg != "" {
		_ = dbforward.UpdateForwardRule(rule.ID, map[string]interface{}{"realm_config": entryCfg})
	}
	requests := buildUpdateRequests(rule, cfgs, settings.StatsReportInterval, settings.HealthCheckInterval, settings.RealmCrashRestartLimit, settings.ProcessStopTimeout, template.TemplateToml)
	results := make([]forward.AgentTaskResult, 0, len(requests))
	for nodeID, req := range requests {
		res, err := forward.SendTaskToNode(nodeID, forward.TaskUpdateRealm, req, 20*time.Second)
		if err != nil && res.Message == "" {
			res.Message = err.Error()
		}
		results = append(results, res)
	}
	api.RespondSuccess(c, results)
}

func resolveNodeIP(nodeID string) (string, error) {
	cli, err := clients.GetClientByUUID(nodeID)
	if err != nil {
		return "", err
	}
	if ip := strings.TrimSpace(cli.IPv4); ip != "" {
		return ip, nil
	}
	if ip := strings.TrimSpace(cli.IPv6); ip != "" {
		return ip, nil
	}
	return "", fmt.Errorf("node %s has no IP", nodeID)
}

func collectNodes(rule *models.ForwardRule) []string {
	var cfg forward.RuleConfig
	_ = json.Unmarshal([]byte(rule.ConfigJSON), &cfg)
	set := map[string]struct{}{cfg.EntryNodeID: {}}
	switch strings.ToLower(rule.Type) {
	case "relay_group":
		for _, r := range cfg.Relays {
			set[r.NodeID] = struct{}{}
		}
	case "chain":
		for _, hop := range cfg.Hops {
			if strings.ToLower(hop.Type) == "direct" && hop.NodeID != "" {
				set[hop.NodeID] = struct{}{}
			}
			if strings.ToLower(hop.Type) == "relay_group" {
				for _, r := range hop.Relays {
					set[r.NodeID] = struct{}{}
				}
			}
		}
	}
	nodes := make([]string, 0, len(set))
	for k := range set {
		nodes = append(nodes, k)
	}
	return nodes
}

// buildStartRequests 将生成的配置映射为 StartRealmRequest
func buildStartRequests(rule *models.ForwardRule, cfgs map[string]string, statsInterval int, healthInterval int, crashLimit int, stopTimeout int, templateToml string) map[string]forward.StartRealmRequest {
	var rc forward.RuleConfig
	_ = json.Unmarshal([]byte(rule.ConfigJSON), &rc)
	if rc.EntryRealmConfig == "" && strings.TrimSpace(rule.RealmConfig) != "" {
		rc.EntryRealmConfig = rule.RealmConfig
	}
	protocol := strings.TrimSpace(rc.Protocol)
	if protocol == "" {
		protocol = "tcp"
	}

	requests := make(map[string]forward.StartRealmRequest)

	add := func(nodeID string, port int, config string) {
		requests[nodeID] = forward.StartRealmRequest{
			RuleID:        rule.ID,
			NodeID:        nodeID,
			EntryNodeID:   rc.EntryNodeID,
			Protocol:      protocol,
			Config:        config,
			Port:          port,
			StatsInterval: statsInterval,
			HealthCheckInterval: healthInterval,
			CrashRestartLimit: crashLimit,
			StopTimeout:       stopTimeout,
		}
	}

	// entry
	if config, ok := cfgs[rc.EntryNodeID]; ok {
		add(rc.EntryNodeID, portValue(rc.EntryCurrentPort, rc.EntryPort), config)
	}
	nextHop, endToEnd := buildHealthTargets(rule.Type, rc)
	if entryReq, ok := requests[rc.EntryNodeID]; ok {
		entryReq.HealthCheckNextHop = nextHop
		entryReq.HealthCheckTarget = endToEnd
		requests[rc.EntryNodeID] = entryReq
	}

	switch strings.ToLower(rule.Type) {
	case "relay_group":
		// priority 策略需要为入口节点准备切换配置
		if strings.ToLower(rc.Strategy) == "priority" {
			entryReq := requests[rc.EntryNodeID]
			entryReq.PriorityListenPort = portValue(rc.EntryCurrentPort, rc.EntryPort)
			entryReq.PriorityRelays = forward.SortRelays(rc.Relays)
			entryReq.ActiveRelayNodeID = rc.ActiveRelayNode
			entryReq.PriorityConfigs = buildPriorityEntryConfigs(rule.ID, rc, templateToml)
			requests[rc.EntryNodeID] = entryReq
		}
		for _, r := range rc.Relays {
			if cfg, ok := cfgs[r.NodeID]; ok {
				add(r.NodeID, portValue(r.CurrentPort, r.Port), cfg)
			}
		}
	case "chain":
		for _, hop := range rc.Hops {
			if strings.ToLower(hop.Type) == "direct" {
				if cfg, ok := cfgs[hop.NodeID]; ok {
					add(hop.NodeID, portValue(hop.CurrentPort, hop.Port), cfg)
				}
			} else if strings.ToLower(hop.Type) == "relay_group" {
				for _, r := range hop.Relays {
					if cfg, ok := cfgs[r.NodeID]; ok {
						add(r.NodeID, portValue(r.CurrentPort, r.Port), cfg)
					}
				}
			}
		}
	}

	return requests
}

func collectNodePorts(rule *models.ForwardRule) map[string]int {
	var rc forward.RuleConfig
	_ = json.Unmarshal([]byte(rule.ConfigJSON), &rc)
	res := map[string]int{
		rc.EntryNodeID: portValue(rc.EntryCurrentPort, rc.EntryPort),
	}
	if strings.ToLower(rule.Type) == "relay_group" {
		for _, r := range rc.Relays {
			res[r.NodeID] = portValue(r.CurrentPort, r.Port)
		}
	} else if strings.ToLower(rule.Type) == "chain" {
		for _, hop := range rc.Hops {
			if strings.ToLower(hop.Type) == "direct" {
				res[hop.NodeID] = portValue(hop.CurrentPort, hop.Port)
			} else if strings.ToLower(hop.Type) == "relay_group" {
				for _, r := range hop.Relays {
					res[r.NodeID] = portValue(r.CurrentPort, r.Port)
				}
			}
		}
	}
	return res
}

func portValue(current int, spec string) int {
	if current > 0 {
		return current
	}
	if strings.Contains(spec, ",") {
		parts := strings.Split(spec, ",")
		return parsePortSafe(parts[0])
	}
	if strings.Contains(spec, "-") {
		parts := strings.Split(spec, "-")
		return parsePortSafe(parts[0])
	}
	return parsePortSafe(spec)
}

func parsePortSafe(val string) int {
	if p, err := net.LookupPort("tcp", strings.TrimSpace(val)); err == nil {
		return p
	}
	// fallback to manual parse
	p := 0
	fmt.Sscanf(strings.TrimSpace(val), "%d", &p)
	return p
}

// 构造 priority 策略下入口节点的候选配置
func buildPriorityEntryConfigs(ruleID uint, rc forward.RuleConfig, templateToml string) map[string]string {
	result := make(map[string]string)
	listenPort := portValue(rc.EntryCurrentPort, rc.EntryPort)
	relays := forward.SortRelays(rc.Relays)
	for _, r := range relays {
		host, err := resolveNodeIP(r.NodeID)
		if err != nil {
			continue
		}
		targetPort := forward.ResolvePortFallback(r.Port, r.CurrentPort)
		cfg, err := forward.BuildEntryConfigWithManual(ruleID, rc.EntryNodeID, rc.Protocol, listenPort, host, targetPort, templateToml, "", nil, rc.EntryRealmConfig)
		if err != nil {
			continue
		}
		result[r.NodeID] = cfg
	}
	return result
}

// buildUpdateRequests 将生成的配置映射为 UpdateRealmRequest
func buildUpdateRequests(rule *models.ForwardRule, cfgs map[string]string, statsInterval int, healthInterval int, crashLimit int, stopTimeout int, templateToml string) map[string]forward.UpdateRealmRequest {
	var rc forward.RuleConfig
	_ = json.Unmarshal([]byte(rule.ConfigJSON), &rc)
	if rc.EntryRealmConfig == "" && strings.TrimSpace(rule.RealmConfig) != "" {
		rc.EntryRealmConfig = rule.RealmConfig
	}
	protocol := strings.TrimSpace(rc.Protocol)
	if protocol == "" {
		protocol = "tcp"
	}
	requests := make(map[string]forward.UpdateRealmRequest)

	add := func(nodeID string, port int, config string) {
		requests[nodeID] = forward.UpdateRealmRequest{
			RuleID:        rule.ID,
			NodeID:        nodeID,
			Protocol:      protocol,
			NewConfig:     config,
			NewPort:       port,
			StatsInterval: statsInterval,
			HealthCheckInterval: healthInterval,
			CrashRestartLimit: crashLimit,
			StopTimeout:       stopTimeout,
		}
	}

	entryPort := portValue(rc.EntryCurrentPort, rc.EntryPort)
	if config, ok := cfgs[rc.EntryNodeID]; ok {
		add(rc.EntryNodeID, entryPort, config)
	}
	nextHop, endToEnd := buildHealthTargets(rule.Type, rc)
	if entryReq, ok := requests[rc.EntryNodeID]; ok {
		entryReq.HealthCheckNextHop = nextHop
		entryReq.HealthCheckTarget = endToEnd
		requests[rc.EntryNodeID] = entryReq
	}

	switch strings.ToLower(rule.Type) {
	case "relay_group":
		if strings.ToLower(rc.Strategy) == "priority" {
			entryReq := requests[rc.EntryNodeID]
			entryReq.EntryNodeID = rc.EntryNodeID
			entryReq.PriorityListenPort = entryPort
			entryReq.PriorityRelays = forward.SortRelays(rc.Relays)
			entryReq.ActiveRelayNodeID = rc.ActiveRelayNode
			entryReq.PriorityConfigs = buildPriorityEntryConfigs(rule.ID, rc, templateToml)
			requests[rc.EntryNodeID] = entryReq
		}
		for _, r := range rc.Relays {
			if cfg, ok := cfgs[r.NodeID]; ok {
				add(r.NodeID, portValue(r.CurrentPort, r.Port), cfg)
			}
		}
	case "chain":
		for _, hop := range rc.Hops {
			if strings.ToLower(hop.Type) == "direct" {
				if cfg, ok := cfgs[hop.NodeID]; ok {
					add(hop.NodeID, portValue(hop.CurrentPort, hop.Port), cfg)
				}
			} else if strings.ToLower(hop.Type) == "relay_group" {
				for _, r := range hop.Relays {
					if cfg, ok := cfgs[r.NodeID]; ok {
						add(r.NodeID, portValue(r.CurrentPort, r.Port), cfg)
					}
				}
			}
		}
	}

	return requests
}

func buildHealthTargets(ruleType string, cfg forward.RuleConfig) (string, string) {
	targetHost, targetPort := resolveTarget(cfg)
	endToEnd := ""
	if targetHost != "" && targetPort > 0 {
		endToEnd = fmt.Sprintf("%s:%d", targetHost, targetPort)
	}
	nextHost, nextPort := resolveEntryNextHop(cfg, ruleType)
	nextHop := ""
	if nextHost != "" && nextPort > 0 {
		nextHop = fmt.Sprintf("%s:%d", nextHost, nextPort)
	}
	return nextHop, endToEnd
}

func resolveTarget(cfg forward.RuleConfig) (string, int) {
	if strings.ToLower(cfg.TargetType) == "node" {
		host, _ := resolveNodeIP(cfg.TargetNodeID)
		return host, cfg.TargetPort
	}
	return cfg.TargetHost, cfg.TargetPort
}

func resolveEntryNextHop(cfg forward.RuleConfig, ruleType string) (string, int) {
	switch strings.ToLower(ruleType) {
	case "direct":
		return resolveTarget(cfg)
	case "relay_group":
		nodeID := cfg.ActiveRelayNode
		if nodeID == "" && len(cfg.Relays) > 0 {
			nodeID = forward.SortRelays(cfg.Relays)[0].NodeID
		}
		host, _ := resolveNodeIP(nodeID)
		var port int
		for _, r := range cfg.Relays {
			if r.NodeID == nodeID {
				port = forward.ResolvePortFallback(r.Port, r.CurrentPort)
				break
			}
		}
		return host, port
	case "chain":
		if len(cfg.Hops) == 0 {
			return "", 0
		}
		return resolveHopTarget(cfg.Hops[0])
	default:
		return "", 0
	}
}

func resolveHopTarget(hop forward.ChainHop) (string, int) {
	if strings.ToLower(hop.Type) == "direct" {
		host, _ := resolveNodeIP(hop.NodeID)
		return host, forward.ResolvePortFallback(hop.Port, hop.CurrentPort)
	}
	if strings.ToLower(hop.Type) == "relay_group" && len(hop.Relays) > 0 {
		active := hop.ActiveRelayNode
		if active == "" {
			active = forward.SortRelays(hop.Relays)[0].NodeID
		}
		host, _ := resolveNodeIP(active)
		var port int
		for _, r := range hop.Relays {
			if r.NodeID == active {
				port = forward.ResolvePortFallback(r.Port, r.CurrentPort)
				break
			}
		}
		return host, port
	}
	return "", 0
}
