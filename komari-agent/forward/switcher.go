package forward

import (
	"log"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/komari-monitor/komari-agent/ws"
)

// PrioritySwitcher 负责 priority 策略的健康检测与自动切换（入口节点负责切换）
type PrioritySwitcher struct {
	health  *HealthChecker
	process *ProcessManager
	mu      sync.Mutex
	stops   map[uint]chan struct{}
}

func NewPrioritySwitcher(health *HealthChecker, process *ProcessManager) *PrioritySwitcher {
	return &PrioritySwitcher{
		health:  health,
		process: process,
		stops:   make(map[uint]chan struct{}),
	}
}

// Stop 停止指定规则的优先级监控
func (p *PrioritySwitcher) Stop(ruleID uint) {
	p.mu.Lock()
	ch, ok := p.stops[ruleID]
	if ok {
		delete(p.stops, ruleID)
	}
	p.mu.Unlock()
	if ok {
		close(ch)
	}
}

func (p *PrioritySwitcher) prepareStop(ruleID uint) chan struct{} {
	p.mu.Lock()
	defer p.mu.Unlock()
	if old, ok := p.stops[ruleID]; ok {
		close(old)
	}
	ch := make(chan struct{})
	p.stops[ruleID] = ch
	return ch
}

func (p *PrioritySwitcher) cleanupStop(ruleID uint, ch chan struct{}) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if cur, ok := p.stops[ruleID]; ok && cur == ch {
		delete(p.stops, ruleID)
	}
}

// MonitorAndSwitch 仅对 relay_group/priority 的入口节点执行
func (p *PrioritySwitcher) MonitorAndSwitch(conn *ws.SafeConn, ruleID uint, entryNodeID string, relays []RelayNode, configs map[string]string, currentActive string, listenPort int, statsInterval time.Duration, protocol string, healthInterval int, healthTarget string) {
	if len(relays) == 0 || conn == nil || len(configs) == 0 || p.process == nil {
		return
	}
	sorted := sortPriorityRelays(relays)
	remoteAddrs := make(map[string]string, len(configs))
	for nodeID, cfg := range configs {
		if addr := parseRemoteAddr(cfg); addr != "" {
			remoteAddrs[nodeID] = addr
		}
	}
	if len(remoteAddrs) == 0 {
		log.Printf("priority switcher: no remote target parsed for rule %d", ruleID)
		return
	}
	if statsInterval <= 0 {
		statsInterval = 10 * time.Second
	}

	activeID := currentActive
	if activeID == "" && len(sorted) > 0 {
		activeID = sorted[0].NodeID
	}

	stopCh := p.prepareStop(ruleID)
	defer p.cleanupStop(ruleID, stopCh)

	ticker := time.NewTicker(statsInterval)
	defer ticker.Stop()

	checkOnce := func() {
		candidate := ""
		for _, relay := range sorted {
			addr := remoteAddrs[relay.NodeID]
			if addr == "" {
				continue
			}
			latency, ok := PingLatencyWithProtocol(protocol, addr, 3*time.Second)
			p.health.RecordStatus(ruleID, relay.NodeID, ok, latency)
			if ok {
				candidate = relay.NodeID
				break
			}
		}
		if candidate == "" || candidate == activeID {
			return
		}
		cfg := configs[candidate]
		if cfg == "" {
			log.Printf("priority switch skipped: empty config for relay %s", candidate)
			return
		}
		if _, err := p.process.Update(UpdateRealmRequest{
			RuleID:              ruleID,
			NodeID:              entryNodeID,
			Protocol:            protocol,
			NewConfig:           cfg,
			NewPort:             listenPort,
			StatsInterval:       int(statsInterval / time.Second),
			HealthCheckInterval: healthInterval,
			HealthCheckNextHop:  remoteAddrs[candidate],
			HealthCheckTarget:   healthTarget,
		}, conn); err != nil {
			log.Printf("priority switch update failed: %v", err)
			return
		}
		reportConfigChange(conn, ruleID, entryNodeID, cfg, map[string]interface{}{
			"active_relay_node_id": candidate,
		}, "priority_switch")
		activeID = candidate
	}

	checkOnce()

	for {
		select {
		case <-stopCh:
			return
		case <-ticker.C:
			checkOnce()
		}
	}
}

func sortPriorityRelays(relays []RelayNode) []RelayNode {
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

func parseRemoteAddr(cfg string) string {
	lines := strings.Split(cfg, "\n")
	for _, line := range lines {
		trim := strings.TrimSpace(line)
		if strings.HasPrefix(trim, "remote") {
			parts := strings.SplitN(trim, "=", 2)
			if len(parts) != 2 {
				continue
			}
			addr := strings.TrimSpace(parts[1])
			addr = strings.Trim(addr, "\"")
			if addr != "" {
				return addr
			}
		}
	}
	return ""
}
