package forward

import (
	"encoding/json"
	"strings"
	"time"

	dbforward "github.com/komari-monitor/komari/database/forward"
	"github.com/komari-monitor/komari/database/models"
	wsmsg "github.com/komari-monitor/komari/ws"
)

// UpdateStatsAndBroadcast 写入 forward_stats 并通过 WS 向前端推送
func UpdateStatsAndBroadcast(stat *models.ForwardStat) {
	_ = dbforward.UpsertForwardStat(stat) // ignore error here; caller可自行处理
	if totalConns, totalIn, totalOut, err := dbforward.AggregateForwardStats(stat.RuleID); err == nil {
		_ = dbforward.UpdateForwardRule(stat.RuleID, map[string]interface{}{
			"total_connections": totalConns,
			"total_traffic_in":  totalIn,
			"total_traffic_out": totalOut,
		})
	}
	entryID, overallStatus, prevStatus := deriveOverallStatus(stat.RuleID)
	if entryID != "" && overallStatus != "" {
		if entryID == stat.NodeID {
			stat.LinkStatus = overallStatus
		}
		if overallStatus != prevStatus {
			_ = dbforward.UpdateForwardStatStatus(stat.RuleID, entryID, overallStatus)
			if entryID != stat.NodeID {
				EvaluateForwardAlerts(&models.ForwardStat{
					RuleID:     stat.RuleID,
					NodeID:     entryID,
					LinkStatus: overallStatus,
				})
			}
		}
	}
	RecordTrafficHistory(stat)
	EvaluateForwardAlerts(stat)

	// WebSocket 推送事件格式与方案一致
	type payload struct {
		RuleID   uint                `json:"rule_id"`
		NodeID   string              `json:"node_id"`
		Status   string              `json:"link_status"`
		Stats    *models.ForwardStat `json:"stats"`
		Reason   string              `json:"reason,omitempty"`
		DateTime time.Time           `json:"timestamp"`
	}
	data, err := json.Marshal(payload{
		RuleID:   stat.RuleID,
		NodeID:   stat.NodeID,
		Status:   stat.LinkStatus,
		Stats:    stat,
		DateTime: time.Now().UTC(),
	})
	if err == nil {
		wsmsg.BroadcastToUsers("forward_stats_update", string(data))
	}
}

func deriveOverallStatus(ruleID uint) (entryID string, overall string, prev string) {
	rule, err := dbforward.GetForwardRule(ruleID)
	if err != nil || rule == nil {
		return "", "", ""
	}
	var cfg RuleConfig
	if err := json.Unmarshal([]byte(rule.ConfigJSON), &cfg); err != nil {
		return "", "", ""
	}
	entryID = cfg.EntryNodeID
	if entryID == "" {
		return "", "", ""
	}
	stats, err := dbforward.GetForwardStats(ruleID)
	if err != nil {
		return entryID, "", ""
	}
	statMap := make(map[string]models.ForwardStat, len(stats))
	for _, s := range stats {
		statMap[s.NodeID] = s
	}
	entryStat, ok := statMap[entryID]
	if ok {
		prev = strings.ToLower(entryStat.LinkStatus)
	}

	overall = normalizeStatus(prev)
	if overall == "" {
		overall = "healthy"
	}

	for _, nodeID := range collectRelatedNodes(cfg, rule.Type) {
		if nodeID == entryID {
			continue
		}
		if stat, ok := statMap[nodeID]; ok {
			status := normalizeStatus(stat.LinkStatus)
			if status == "faulty" {
				if overall == "healthy" {
					overall = "degraded"
				}
			}
			if status == "degraded" && overall == "healthy" {
				overall = "degraded"
			}
		}
	}
	if prev == "faulty" {
		overall = "faulty"
	}
	return entryID, overall, prev
}

func normalizeStatus(status string) string {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "healthy", "degraded", "faulty":
		return strings.ToLower(status)
	default:
		return ""
	}
}

func collectRelatedNodes(cfg RuleConfig, ruleType string) []string {
	nodes := []string{}
	if cfg.EntryNodeID != "" {
		nodes = append(nodes, cfg.EntryNodeID)
	}
	switch strings.ToLower(ruleType) {
	case "relay_group":
		for _, r := range cfg.Relays {
			if r.NodeID != "" {
				nodes = append(nodes, r.NodeID)
			}
		}
	case "chain":
		for _, hop := range cfg.Hops {
			if strings.ToLower(hop.Type) == "direct" && hop.NodeID != "" {
				nodes = append(nodes, hop.NodeID)
			}
			if strings.ToLower(hop.Type) == "relay_group" {
				for _, r := range hop.Relays {
					if r.NodeID != "" {
						nodes = append(nodes, r.NodeID)
					}
				}
			}
		}
	}
	return nodes
}
