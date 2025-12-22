package forward

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/komari-monitor/komari/database/clients"
	dbforward "github.com/komari-monitor/komari/database/forward"
	"github.com/komari-monitor/komari/database/models"
)

type nodeChange struct {
	NodeID    string
	Action    string // start / stop / update
	OldConfig string
	NewConfig string
	OldPort   int
	NewPort   int
}

// ApplyHotUpdate 根据新旧规则差异执行热更新
func ApplyHotUpdate(oldRule, newRule *models.ForwardRule) error {
	if oldRule == nil || newRule == nil {
		return errors.New("rule is nil")
	}
	var oldCfg RuleConfig
	var newCfg RuleConfig
	_ = json.Unmarshal([]byte(oldRule.ConfigJSON), &oldCfg)
	_ = json.Unmarshal([]byte(newRule.ConfigJSON), &newCfg)
	oldProto := oldCfg.Protocol
	newProto := newCfg.Protocol
	template, err := dbforward.GetRealmConfigTemplate()
	if err != nil {
		return err
	}
	settings, err := dbforward.GetSystemSettings()
	if err != nil {
		return err
	}
	oldCfgs, err := GenerateRealmConfigs(*oldRule, template.TemplateToml, resolveNodeIP)
	if err != nil {
		return fmt.Errorf("generate old config: %w", err)
	}
	newCfgs, err := GenerateRealmConfigs(*newRule, template.TemplateToml, resolveNodeIP)
	if err != nil {
		return fmt.Errorf("generate new config: %w", err)
	}
	oldPorts := collectNodePorts(oldRule)
	newPorts := collectNodePorts(newRule)

	changes := detectNodeChanges(oldCfgs, newCfgs, oldPorts, newPorts)
	if len(changes) == 0 {
		return nil
	}
	order := updateOrder(newRule, changes)
	applied := make([]nodeChange, 0, len(order))
	for _, nodeID := range order {
		change, ok := changes[nodeID]
		if !ok {
			continue
		}
		if err := applyNodeChange(newRule, change, oldProto, newProto, template.TemplateToml, settings.StatsReportInterval, settings.HealthCheckInterval, settings.RealmCrashRestartLimit, settings.ProcessStopTimeout); err != nil {
			rollbackChanges(newRule, applied, oldProto, newProto, template.TemplateToml, settings.StatsReportInterval, settings.HealthCheckInterval, settings.RealmCrashRestartLimit, settings.ProcessStopTimeout)
			return fmt.Errorf("hot update failed at node %s: %w", nodeID, err)
		}
		applied = append(applied, change)
	}
	return nil
}

func detectNodeChanges(oldCfgs, newCfgs map[string]string, oldPorts, newPorts map[string]int) map[string]nodeChange {
	nodes := make(map[string]struct{})
	for k := range oldCfgs {
		nodes[k] = struct{}{}
	}
	for k := range newCfgs {
		nodes[k] = struct{}{}
	}
	out := make(map[string]nodeChange)
	for nodeID := range nodes {
		oldCfg := oldCfgs[nodeID]
		newCfg := newCfgs[nodeID]
		change := nodeChange{
			NodeID:    nodeID,
			OldConfig: oldCfg,
			NewConfig: newCfg,
			OldPort:   oldPorts[nodeID],
			NewPort:   newPorts[nodeID],
		}
		switch {
		case newCfg == "" && oldCfg != "":
			change.Action = "stop"
		case newCfg != "" && oldCfg == "":
			change.Action = "start"
		case newCfg != "" && oldCfg != "" && (newCfg != oldCfg || change.OldPort != change.NewPort):
			change.Action = "update"
		default:
			continue
		}
		out[nodeID] = change
	}
	return out
}

func applyNodeChange(rule *models.ForwardRule, change nodeChange, oldProtocol string, newProtocol string, templateToml string, statsInterval int, healthInterval int, crashLimit int, stopTimeout int) error {
	switch change.Action {
	case "stop":
		req := StopRealmRequest{
			RuleID: rule.ID,
			NodeID: change.NodeID,
			Protocol: oldProtocol,
			Port:   change.OldPort,
		}
		if stopTimeout > 0 {
			req.Timeout = stopTimeout
		}
		_, err := SendTaskToNode(change.NodeID, TaskStopRealm, req, 15*time.Second)
		return err
	case "start":
		startReqs := buildStartRequests(rule, map[string]string{change.NodeID: change.NewConfig}, statsInterval, healthInterval, crashLimit, stopTimeout, templateToml)
		if req, ok := startReqs[change.NodeID]; ok {
			req.Protocol = newProtocol
			_, err := SendTaskToNode(change.NodeID, TaskStartRealm, req, 20*time.Second)
			return err
		}
	case "update":
		updateReqs := buildUpdateRequests(rule, map[string]string{change.NodeID: change.NewConfig}, statsInterval, healthInterval, crashLimit, stopTimeout, templateToml)
		if req, ok := updateReqs[change.NodeID]; ok {
			req.Protocol = newProtocol
			if stopTimeout > 0 {
				req.StopTimeout = stopTimeout
			}
			_, err := SendTaskToNode(change.NodeID, TaskUpdateRealm, req, 20*time.Second)
			return err
		}
	}
	return nil
}

func rollbackChanges(rule *models.ForwardRule, applied []nodeChange, oldProtocol string, newProtocol string, templateToml string, statsInterval int, healthInterval int, crashLimit int, stopTimeout int) {
	for i := len(applied) - 1; i >= 0; i-- {
		change := applied[i]
		switch change.Action {
		case "start":
			req := StopRealmRequest{
				RuleID: rule.ID,
				NodeID: change.NodeID,
				Protocol: newProtocol,
				Port:   change.NewPort,
			}
			if stopTimeout > 0 {
				req.Timeout = stopTimeout
			}
			_, _ = SendTaskToNode(change.NodeID, TaskStopRealm, req, 10*time.Second)
		case "stop":
			if change.OldConfig == "" {
				continue
			}
			startReqs := buildStartRequests(rule, map[string]string{change.NodeID: change.OldConfig}, statsInterval, healthInterval, crashLimit, stopTimeout, templateToml)
			if req, ok := startReqs[change.NodeID]; ok {
				req.Protocol = oldProtocol
				_, _ = SendTaskToNode(change.NodeID, TaskStartRealm, req, 10*time.Second)
			}
		case "update":
			if change.OldConfig == "" {
				continue
			}
			updateReqs := buildUpdateRequests(rule, map[string]string{change.NodeID: change.OldConfig}, statsInterval, healthInterval, crashLimit, stopTimeout, templateToml)
			if req, ok := updateReqs[change.NodeID]; ok {
				req.Protocol = oldProtocol
				if stopTimeout > 0 {
					req.StopTimeout = stopTimeout
				}
				_, _ = SendTaskToNode(change.NodeID, TaskUpdateRealm, req, 10*time.Second)
			}
		}
	}
}

func updateOrder(rule *models.ForwardRule, changes map[string]nodeChange) []string {
	var rc RuleConfig
	_ = json.Unmarshal([]byte(rule.ConfigJSON), &rc)
	order := make([]string, 0, len(changes))

	// 目标节点（若为 node）
	if strings.ToLower(rc.TargetType) == "node" && rc.TargetNodeID != "" {
		order = append(order, rc.TargetNodeID)
	}

	switch strings.ToLower(rule.Type) {
	case "relay_group":
		for _, r := range SortRelays(rc.Relays) {
			order = append(order, r.NodeID)
		}
	case "chain":
		for i := len(rc.Hops) - 1; i >= 0; i-- {
			hop := rc.Hops[i]
			if strings.ToLower(hop.Type) == "direct" && hop.NodeID != "" {
				order = append(order, hop.NodeID)
			} else if strings.ToLower(hop.Type) == "relay_group" {
				for _, r := range SortRelays(hop.Relays) {
					order = append(order, r.NodeID)
				}
			}
		}
	}

	if rc.EntryNodeID != "" {
		order = append(order, rc.EntryNodeID)
	}

	// 添加遗漏节点
	seen := map[string]struct{}{}
	for _, id := range order {
		seen[id] = struct{}{}
	}
	for id := range changes {
		if _, ok := seen[id]; !ok {
			order = append(order, id)
		}
	}
	return order
}

func collectNodePorts(rule *models.ForwardRule) map[string]int {
	var rc RuleConfig
	_ = json.Unmarshal([]byte(rule.ConfigJSON), &rc)
	res := map[string]int{}
	if rc.EntryNodeID != "" {
		res[rc.EntryNodeID] = portValue(rc.EntryCurrentPort, rc.EntryPort)
	}
	switch strings.ToLower(rule.Type) {
	case "relay_group":
		for _, r := range rc.Relays {
			res[r.NodeID] = portValue(r.CurrentPort, r.Port)
		}
	case "chain":
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
	return ResolvePortFallback(spec, current)
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

func buildPriorityEntryConfigs(ruleID uint, rc RuleConfig, templateToml string) map[string]string {
	result := make(map[string]string)
	listenPort := portValue(rc.EntryCurrentPort, rc.EntryPort)
	relays := SortRelays(rc.Relays)
	for _, r := range relays {
		host, err := resolveNodeIP(r.NodeID)
		if err != nil {
			continue
		}
		targetPort := ResolvePortFallback(r.Port, r.CurrentPort)
		cfg, err := BuildEntryConfigWithManual(ruleID, rc.EntryNodeID, rc.Protocol, listenPort, host, targetPort, templateToml, "", nil, rc.EntryRealmConfig)
		if err != nil {
			continue
		}
		result[r.NodeID] = cfg
	}
	return result
}

func buildStartRequests(rule *models.ForwardRule, cfgs map[string]string, statsInterval int, healthInterval int, crashLimit int, stopTimeout int, templateToml string) map[string]StartRealmRequest {
	var rc RuleConfig
	_ = json.Unmarshal([]byte(rule.ConfigJSON), &rc)
	if rc.EntryRealmConfig == "" && strings.TrimSpace(rule.RealmConfig) != "" {
		rc.EntryRealmConfig = rule.RealmConfig
	}
	protocol := strings.TrimSpace(rc.Protocol)
	if protocol == "" {
		protocol = "tcp"
	}
	requests := make(map[string]StartRealmRequest)
	add := func(nodeID string, port int, config string) {
		requests[nodeID] = StartRealmRequest{
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
		if strings.ToLower(rc.Strategy) == "priority" {
			entryReq := requests[rc.EntryNodeID]
			entryReq.PriorityListenPort = portValue(rc.EntryCurrentPort, rc.EntryPort)
			entryReq.PriorityRelays = SortRelays(rc.Relays)
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

func buildUpdateRequests(rule *models.ForwardRule, cfgs map[string]string, statsInterval int, healthInterval int, crashLimit int, stopTimeout int, templateToml string) map[string]UpdateRealmRequest {
	var rc RuleConfig
	_ = json.Unmarshal([]byte(rule.ConfigJSON), &rc)
	if rc.EntryRealmConfig == "" && strings.TrimSpace(rule.RealmConfig) != "" {
		rc.EntryRealmConfig = rule.RealmConfig
	}
	protocol := strings.TrimSpace(rc.Protocol)
	if protocol == "" {
		protocol = "tcp"
	}
	requests := make(map[string]UpdateRealmRequest)
	add := func(nodeID string, port int, config string) {
		requests[nodeID] = UpdateRealmRequest{
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
			entryReq.PriorityRelays = SortRelays(rc.Relays)
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

func buildHealthTargets(ruleType string, cfg RuleConfig) (string, string) {
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

func resolveTarget(cfg RuleConfig) (string, int) {
	if strings.ToLower(cfg.TargetType) == "node" {
		host, _ := resolveNodeIP(cfg.TargetNodeID)
		return host, cfg.TargetPort
	}
	return cfg.TargetHost, cfg.TargetPort
}

func resolveEntryNextHop(cfg RuleConfig, ruleType string) (string, int) {
	switch strings.ToLower(ruleType) {
	case "direct":
		return resolveTarget(cfg)
	case "relay_group":
		nodeID := cfg.ActiveRelayNode
		if nodeID == "" && len(cfg.Relays) > 0 {
			nodeID = SortRelays(cfg.Relays)[0].NodeID
		}
		host, _ := resolveNodeIP(nodeID)
		var port int
		for _, r := range cfg.Relays {
			if r.NodeID == nodeID {
				port = ResolvePortFallback(r.Port, r.CurrentPort)
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

func resolveHopTarget(hop ChainHop) (string, int) {
	if strings.ToLower(hop.Type) == "direct" {
		host, _ := resolveNodeIP(hop.NodeID)
		return host, ResolvePortFallback(hop.Port, hop.CurrentPort)
	}
	if strings.ToLower(hop.Type) == "relay_group" && len(hop.Relays) > 0 {
		active := hop.ActiveRelayNode
		if active == "" {
			active = SortRelays(hop.Relays)[0].NodeID
		}
		host, _ := resolveNodeIP(active)
		var port int
		for _, r := range hop.Relays {
			if r.NodeID == active {
				port = ResolvePortFallback(r.Port, r.CurrentPort)
				break
			}
		}
		return host, port
	}
	return "", 0
}
