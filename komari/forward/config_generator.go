package forward

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/komari-monitor/komari/database/models"
)

// GenerateRealmConfigs 根据规则与模板生成节点->TOML配置
func GenerateRealmConfigs(rule models.ForwardRule, templateToml string, resolver NodeResolver) (map[string]string, error) {
	var cfg RuleConfig
	if err := json.Unmarshal([]byte(rule.ConfigJSON), &cfg); err != nil {
		return nil, fmt.Errorf("parse config_json failed: %w", err)
	}
	entryManual := strings.TrimSpace(cfg.EntryRealmConfig)
	if entryManual == "" && strings.TrimSpace(rule.RealmConfig) != "" {
		entryManual = rule.RealmConfig
	}

	cfg.EntryCurrentPort = resolvePortFallback(cfg.EntryPort, cfg.EntryCurrentPort)
	targetHost, err := resolveTargetHost(cfg, resolver)
	if err != nil {
		return nil, err
	}

	configs := make(map[string]string)
	switch strings.ToLower(rule.Type) {
	case "direct":
		entryConfig, err := buildEntryConfigWithManual(rule.ID, cfg.EntryNodeID, cfg.Protocol, cfg.EntryCurrentPort, targetHost, cfg.TargetPort, templateToml, "", nil, entryManual)
		if err != nil {
			return nil, err
		}
		configs[cfg.EntryNodeID] = entryConfig
	case "relay_group":
		if err := generateRelayGroupConfigs(rule.ID, cfg, templateToml, targetHost, resolver, configs, entryManual); err != nil {
			return nil, err
		}
	case "chain":
		if err := generateChainConfigs(rule.ID, cfg, templateToml, targetHost, resolver, configs, entryManual); err != nil {
			return nil, err
		}
	default:
		return nil, fmt.Errorf("unsupported rule type: %s", rule.Type)
	}
	return configs, nil
}

func generateRelayGroupConfigs(ruleID uint, cfg RuleConfig, templateToml, targetHost string, resolver NodeResolver, configs map[string]string, entryManual string) error {
	relays := sortRelays(cfg.Relays)
	if len(relays) == 0 {
		return fmt.Errorf("relay_group requires at least one relay node")
	}

	entryRemoteList, err := relayAddresses(relays, resolver)
	if err != nil {
		return err
	}

	var remoteHost string
	var remotePort int
	var extra []string
	balance := buildBalance(cfg.Strategy, relays)

	if strings.ToLower(cfg.Strategy) == "priority" {
		active := pickActiveRelay(relays, cfg.ActiveRelayNode)
		if active == nil {
			return fmt.Errorf("no active relay node available for priority strategy")
		}
		remoteHost = mustResolveNode(active.NodeID, resolver)
		remotePort = resolvePortFallback(active.Port, active.CurrentPort)
		extra = nil
		balance = ""
	} else {
		first := entryRemoteList[0]
		remoteHost, remotePort = splitHostPort(first)
		if len(entryRemoteList) > 1 {
			extra = entryRemoteList[1:]
		}
	}

	entryCfg, err := buildEntryConfigWithManual(ruleID, cfg.EntryNodeID, cfg.Protocol, cfg.EntryCurrentPort, remoteHost, remotePort, templateToml, balance, extra, entryManual)
	if err != nil {
		return err
	}
	configs[cfg.EntryNodeID] = entryCfg

	// relay nodes
	for _, relay := range relays {
		currentPort := resolvePortFallback(relay.Port, relay.CurrentPort)
		nodeID := relay.NodeID
		content, err := buildEntryConfigWithManual(ruleID, nodeID, cfg.Protocol, currentPort, targetHost, cfg.TargetPort, templateToml, "", nil, relay.RealmConfig)
		if err != nil {
			return err
		}
		configs[nodeID] = content
	}
	return nil
}

func generateChainConfigs(ruleID uint, cfg RuleConfig, templateToml, targetHost string, resolver NodeResolver, configs map[string]string, entryManual string) error {
	if len(cfg.Hops) == 0 {
		return fmt.Errorf("chain rule requires hops")
	}

	firstHopTargets, err := hopTargets(cfg.Hops[0], resolver)
	if err != nil {
		return err
	}
	var remoteHost string
	var remotePort int
	var extra []string
	balance := ""
	if cfg.Hops[0].Type == "relay_group" {
		balance = buildBalance(cfg.Hops[0].Strategy, sortRelays(cfg.Hops[0].Relays))
		if strings.ToLower(cfg.Hops[0].Strategy) == "priority" {
			active := pickActiveRelay(sortRelays(cfg.Hops[0].Relays), cfg.Hops[0].ActiveRelayNode)
			if active == nil {
				return fmt.Errorf("no active relay for first hop priority strategy")
			}
			remoteHost = mustResolveNode(active.NodeID, resolver)
			remotePort = resolvePortFallback(active.Port, active.CurrentPort)
		} else {
			remoteHost, remotePort = splitHostPort(firstHopTargets[0])
			if len(firstHopTargets) > 1 {
				extra = firstHopTargets[1:]
			}
		}
	} else {
		if len(firstHopTargets) == 0 {
			return fmt.Errorf("first hop missing target")
		}
		remoteHost, remotePort = splitHostPort(firstHopTargets[0])
	}

	entryCfg, err := buildEntryConfigWithManual(ruleID, cfg.EntryNodeID, cfg.Protocol, cfg.EntryCurrentPort, remoteHost, remotePort, templateToml, balance, extra, entryManual)
	if err != nil {
		return err
	}
	configs[cfg.EntryNodeID] = entryCfg

	for idx, hop := range cfg.Hops {
		nextTarget, err := nextHopTarget(idx, cfg.Hops, targetHost, cfg.TargetPort, resolver)
		if err != nil {
			return err
		}
		nextHost, nextPort := splitHostPort(nextTarget)
		if strings.ToLower(hop.Type) == "direct" {
			currentPort := resolvePortFallback(hop.Port, hop.CurrentPort)
			content, err := buildEntryConfigWithManual(ruleID, hop.NodeID, cfg.Protocol, currentPort, nextHost, nextPort, templateToml, "", nil, hop.RealmConfig)
			if err != nil {
				return err
			}
			configs[hop.NodeID] = content
		} else if strings.ToLower(hop.Type) == "relay_group" {
			relays := sortRelays(hop.Relays)
			if len(relays) == 0 {
				return fmt.Errorf("hop relay_group requires nodes")
			}
			for _, relay := range relays {
				currentPort := resolvePortFallback(relay.Port, relay.CurrentPort)
				content, err := buildEntryConfigWithManual(ruleID, relay.NodeID, cfg.Protocol, currentPort, nextHost, nextPort, templateToml, "", nil, relay.RealmConfig)
				if err != nil {
					return err
				}
				configs[relay.NodeID] = content
			}
		} else {
			return fmt.Errorf("unsupported hop type: %s", hop.Type)
		}
	}
	return nil
}

// buildEntryConfig 构造单节点 TOML 配置
func buildEntryConfig(ruleID uint, nodeID string, protocol string, listenPort int, targetHost string, targetPort int, templateToml string, balance string, extra []string) (string, error) {
	if listenPort == 0 {
		return "", fmt.Errorf("listen port is zero")
	}
	logPath := fmt.Sprintf("/var/log/komari-agent/realm-rule-%d-node-%s.log", ruleID, nodeID)
	base := buildBaseSections(templateToml, logPath, protocol)

	var sb strings.Builder
	sb.WriteString(base)
	if !strings.HasSuffix(base, "\n") {
		sb.WriteString("\n")
	}
	sb.WriteString("[[endpoints]]\n")
	sb.WriteString(fmt.Sprintf("listen = \"0.0.0.0:%d\"\n", listenPort))
	sb.WriteString(fmt.Sprintf("remote = \"%s:%d\"\n", targetHost, targetPort))
	if len(extra) > 0 {
		quoted := make([]string, 0, len(extra))
		for _, e := range extra {
			quoted = append(quoted, fmt.Sprintf("\"%s\"", e))
		}
		sb.WriteString(fmt.Sprintf("extra_remotes = [%s]\n", strings.Join(quoted, ", ")))
	}
	if balance != "" {
		sb.WriteString(fmt.Sprintf("balance = \"%s\"\n", balance))
	}
	return sb.String(), nil
}

func buildEntryConfigWithManual(ruleID uint, nodeID string, protocol string, listenPort int, targetHost string, targetPort int, templateToml string, balance string, extra []string, manual string) (string, error) {
	base, err := buildEntryConfig(ruleID, nodeID, protocol, listenPort, targetHost, targetPort, templateToml, balance, extra)
	if err != nil {
		return "", err
	}
	trimmed := strings.TrimSpace(manual)
	if trimmed == "" {
		return base, nil
	}
	sanitized := strings.TrimSpace(stripProtectedSections(trimmed))
	if sanitized == "" {
		return base, nil
	}
	if !strings.HasSuffix(base, "\n") {
		base += "\n"
	}
	return base + "\n" + sanitized, nil
}

func buildBaseSections(templateToml, logPath, protocol string) string {
	logSection := extractSection(templateToml, "log")
	networkSection := extractSection(templateToml, "network")

	logSection["output"] = fmt.Sprintf("\"%s\"", logPath)
	if _, ok := logSection["level"]; !ok {
		logSection["level"] = "\"info\""
	}

	useUDP := strings.ToLower(protocol) == "udp" || strings.ToLower(protocol) == "both"
	noTCP := strings.ToLower(protocol) == "udp"
	networkSection["use_udp"] = fmt.Sprintf("%t", useUDP)
	networkSection["no_tcp"] = fmt.Sprintf("%t", noTCP)
	if _, ok := networkSection["tcp_timeout"]; !ok {
		networkSection["tcp_timeout"] = "10"
	}
	if _, ok := networkSection["tcp_keepalive"]; !ok {
		networkSection["tcp_keepalive"] = "30"
	}

	var sb strings.Builder
	sb.WriteString("[log]\n")
	for _, key := range sortedKeys(logSection) {
		sb.WriteString(fmt.Sprintf("%s = %s\n", key, logSection[key]))
	}
	sb.WriteString("\n[network]\n")
	for _, key := range sortedKeys(networkSection) {
		sb.WriteString(fmt.Sprintf("%s = %s\n", key, networkSection[key]))
	}
	return sb.String()
}

func extractSection(tomlStr, section string) map[string]string {
	result := make(map[string]string)
	lines := strings.Split(tomlStr, "\n")
	inSection := false
	for _, line := range lines {
		trim := strings.TrimSpace(line)
		if trim == "" || strings.HasPrefix(trim, "#") {
			continue
		}
		if strings.HasPrefix(trim, "[") {
			inSection = trim == "["+section+"]"
			continue
		}
		if !inSection {
			continue
		}
		parts := strings.SplitN(trim, "=", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.TrimSpace(parts[0])
		val := strings.TrimSpace(parts[1])
		result[key] = val
	}
	return result
}

func stripProtectedSections(tomlStr string) string {
	lines := strings.Split(tomlStr, "\n")
	out := make([]string, 0, len(lines))
	skip := false
	section := ""
	for _, line := range lines {
		trim := strings.TrimSpace(line)
		if name, ok := parseSectionName(trim); ok {
			section = name
			switch name {
			case "log", "endpoints":
				skip = true
				continue
			default:
				skip = false
				out = append(out, line)
				continue
			}
		}
		if skip {
			continue
		}
		if section == "network" {
			key := strings.SplitN(trim, "=", 2)
			if len(key) > 0 {
				k := strings.ToLower(strings.TrimSpace(key[0]))
				if k == "use_udp" || k == "no_tcp" {
					continue
				}
			}
		}
		out = append(out, line)
	}
	return strings.Join(out, "\n")
}

func parseSectionName(trim string) (string, bool) {
	if strings.HasPrefix(trim, "[[") && strings.HasSuffix(trim, "]]") {
		name := strings.TrimSpace(trim[2 : len(trim)-2])
		return strings.ToLower(name), true
	}
	if strings.HasPrefix(trim, "[") && strings.HasSuffix(trim, "]") {
		name := strings.TrimSpace(trim[1 : len(trim)-1])
		return strings.ToLower(name), true
	}
	return "", false
}

func sortedKeys(m map[string]string) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func resolvePortFallback(portSpec string, current int) int {
	if current > 0 {
		return current
	}
	spec := strings.TrimSpace(portSpec)
	if spec == "" {
		return 0
	}
	if strings.Contains(spec, ",") {
		parts := strings.Split(spec, ",")
		return parsePortValue(strings.TrimSpace(parts[0]))
	}
	if strings.Contains(spec, "-") {
		parts := strings.Split(spec, "-")
		return parsePortValue(strings.TrimSpace(parts[0]))
	}
	return parsePortValue(spec)
}

func parsePortValue(val string) int {
	v := strings.TrimSpace(val)
	if v == "" {
		return 0
	}
	var p int
	fmt.Sscanf(v, "%d", &p)
	return p
}

func resolveTargetHost(cfg RuleConfig, resolver NodeResolver) (string, error) {
	if strings.ToLower(cfg.TargetType) == "node" {
		if resolver == nil {
			return "", fmt.Errorf("node resolver not provided for node target")
		}
		return resolver(cfg.TargetNodeID)
	}
	return cfg.TargetHost, nil
}

func relayAddresses(relays []RelayNode, resolver NodeResolver) ([]string, error) {
	addrs := make([]string, 0, len(relays))
	for _, r := range relays {
		if resolver == nil {
			return nil, fmt.Errorf("resolver required for relay nodes")
		}
		host, err := resolver(r.NodeID)
		if err != nil {
			return nil, err
		}
		port := resolvePortFallback(r.Port, r.CurrentPort)
		addrs = append(addrs, fmt.Sprintf("%s:%d", host, port))
	}
	return addrs, nil
}

func sortRelays(relays []RelayNode) []RelayNode {
	result := make([]RelayNode, len(relays))
	copy(result, relays)
	sort.Slice(result, func(i, j int) bool {
		if result[i].SortOrder == result[j].SortOrder {
			return result[i].NodeID < result[j].NodeID
		}
		return result[i].SortOrder < result[j].SortOrder
	})
	return result
}

func buildBalance(strategy string, relays []RelayNode) string {
	strategy = strings.ToLower(strategy)
	switch strategy {
	case "roundrobin":
		weights := make([]string, 0, len(relays))
		hasWeight := false
		for _, r := range relays {
			w := r.SortOrder
			if w <= 0 {
				w = 1
			} else {
				hasWeight = true
			}
			weights = append(weights, fmt.Sprintf("%d", w))
		}
		if hasWeight {
			return fmt.Sprintf("roundrobin: %s", strings.Join(weights, ", "))
		}
		return "roundrobin"
	case "random":
		return "random"
	case "iphash":
		return "iphash"
	case "latency", "speed":
		// 预留策略，暂用 roundrobin 兜底
		return "roundrobin"
	default:
		return ""
	}
}

func pickActiveRelay(relays []RelayNode, activeID string) *RelayNode {
	for _, r := range relays {
		if r.NodeID == activeID {
			return &r
		}
	}
	if len(relays) == 0 {
		return nil
	}
	return &relays[0]
}

func hopTargets(hop ChainHop, resolver NodeResolver) ([]string, error) {
	switch strings.ToLower(hop.Type) {
	case "relay_group":
		return relayAddresses(sortRelays(hop.Relays), resolver)
	case "direct":
		if resolver == nil {
			return nil, fmt.Errorf("resolver required for hop direct")
		}
		host, err := resolver(hop.NodeID)
		if err != nil {
			return nil, err
		}
		port := resolvePortFallback(hop.Port, hop.CurrentPort)
		if port == 0 {
			return nil, fmt.Errorf("hop port missing for node %s", hop.NodeID)
		}
		return []string{fmt.Sprintf("%s:%d", host, port)}, nil
	default:
		return nil, fmt.Errorf("unsupported hop type: %s", hop.Type)
	}
}

func nextHopTarget(currentIndex int, hops []ChainHop, finalTargetHost string, finalTargetPort int, resolver NodeResolver) (string, error) {
	if currentIndex+1 < len(hops) {
		nextTargets, err := hopTargets(hops[currentIndex+1], resolver)
		if err != nil {
			return "", err
		}
		if len(nextTargets) == 0 {
			return "", fmt.Errorf("next hop has no targets")
		}
		return nextTargets[0], nil
	}
	return fmt.Sprintf("%s:%d", finalTargetHost, finalTargetPort), nil
}

func splitHostPort(address string) (string, int) {
	if idx := strings.LastIndex(address, ":"); idx != -1 {
		host := address[:idx]
		var port int
		fmt.Sscanf(address[idx+1:], "%d", &port)
		return host, port
	}
	return address, 0
}

func mustResolveNode(nodeID string, resolver NodeResolver) string {
	host, _ := resolver(nodeID)
	return host
}

// BuildEntryConfig 对外暴露单节点配置生成，供入口节点优先级切换使用
func BuildEntryConfig(ruleID uint, nodeID string, protocol string, listenPort int, targetHost string, targetPort int, templateToml string, balance string, extra []string) (string, error) {
	return buildEntryConfig(ruleID, nodeID, protocol, listenPort, targetHost, targetPort, templateToml, balance, extra)
}

// BuildEntryConfigWithManual merges manual config while keeping endpoints/log/network controlled by system.
func BuildEntryConfigWithManual(ruleID uint, nodeID string, protocol string, listenPort int, targetHost string, targetPort int, templateToml string, balance string, extra []string, manual string) (string, error) {
	return buildEntryConfigWithManual(ruleID, nodeID, protocol, listenPort, targetHost, targetPort, templateToml, balance, extra, manual)
}

// SanitizeManualRealmConfig removes protected sections and enforced keys from manual config.
func SanitizeManualRealmConfig(manual string) string {
	trimmed := strings.TrimSpace(manual)
	if trimmed == "" {
		return ""
	}
	return strings.TrimSpace(stripProtectedSections(trimmed))
}

// ResolvePortFallback 对外暴露端口回退解析
func ResolvePortFallback(portSpec string, current int) int {
	return resolvePortFallback(portSpec, current)
}

// SortRelays 对外暴露中继节点排序
func SortRelays(relays []RelayNode) []RelayNode {
	return sortRelays(relays)
}
