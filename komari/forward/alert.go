package forward

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	dbforward "github.com/komari-monitor/komari/database/forward"
	"github.com/komari-monitor/komari/database/models"
	messageevent "github.com/komari-monitor/komari/database/models/messageEvent"
	"github.com/komari-monitor/komari/utils/messageSender"
	"gorm.io/gorm"
)

const (
	alertDedupWindow  = 5 * time.Minute
	alertAckSilence   = 24 * time.Hour
	latencyKeyDefault = "self"
)

type alertCandidate struct {
	alertType string
	eventType string
	severity  string
	message   string
	details   map[string]interface{}
	emoji     string
}

// EvaluateForwardAlerts 基于最新统计触发告警
func EvaluateForwardAlerts(stat *models.ForwardStat) {
	if stat == nil {
		return
	}
	cfg, err := dbforward.GetAlertConfig(stat.RuleID)
	if err != nil || !cfg.Enabled {
		return
	}
	rule, err := dbforward.GetForwardRule(stat.RuleID)
	if err != nil {
		return
	}
	var rc RuleConfig
	_ = json.Unmarshal([]byte(rule.ConfigJSON), &rc)

	candidates := buildAlertCandidates(stat, cfg, rule, rc)
	for _, cand := range candidates {
		if cand.alertType == "" {
			continue
		}
		if shouldSuppressAlert(stat.RuleID, cand.alertType) {
			continue
		}
		_ = sendForwardAlert(rule, cand)
	}
}

func buildAlertCandidates(stat *models.ForwardStat, cfg *models.ForwardAlertConfig, rule *models.ForwardRule, rc RuleConfig) []alertCandidate {
	candidates := make([]alertCandidate, 0, 4)
	isEntry := rc.EntryNodeID != "" && stat.NodeID == rc.EntryNodeID

	if isEntry {
		if strings.ToLower(stat.LinkStatus) == "faulty" && cfg.LinkFaultyEnabled {
			candidates = append(candidates, alertCandidate{
				alertType: "link_faulty",
				eventType: messageevent.ForwardLinkFaulty,
				severity:  "critical",
				message:   fmt.Sprintf("转发规则 [%s] 链路故障", rule.Name),
				details: map[string]interface{}{
					"node_id":   stat.NodeID,
					"rule_id":   stat.RuleID,
					"status":    stat.LinkStatus,
					"is_entry":  true,
					"timestamp": time.Now().UTC(),
				},
				emoji: "⛔",
			})
		}
		if strings.ToLower(stat.LinkStatus) == "degraded" && cfg.LinkDegradedEnabled {
			candidates = append(candidates, alertCandidate{
				alertType: "link_degraded",
				eventType: messageevent.ForwardLinkDegraded,
				severity:  "warning",
				message:   fmt.Sprintf("转发规则 [%s] 链路降级", rule.Name),
				details: map[string]interface{}{
					"node_id":   stat.NodeID,
					"rule_id":   stat.RuleID,
					"status":    stat.LinkStatus,
					"is_entry":  true,
					"timestamp": time.Now().UTC(),
				},
				emoji: "🟡",
			})
		}
	} else if strings.ToLower(stat.LinkStatus) == "faulty" && cfg.NodeDownEnabled {
		candidates = append(candidates, alertCandidate{
			alertType: "node_down",
			eventType: messageevent.ForwardNodeDown,
			severity:  "critical",
			message:   fmt.Sprintf("转发规则 [%s] 节点异常", rule.Name),
			details: map[string]interface{}{
				"node_id":   stat.NodeID,
				"rule_id":   stat.RuleID,
				"status":    stat.LinkStatus,
				"is_entry":  false,
				"timestamp": time.Now().UTC(),
			},
			emoji: "🔴",
		})
	}

	if cfg.HighLatencyEnabled {
		if latency, ok := parseLatency(stat.NodesLatency, latencyKeyDefault); ok && latency >= int64(cfg.HighLatencyThreshold) {
			candidates = append(candidates, alertCandidate{
				alertType: "high_latency",
				eventType: messageevent.ForwardHighLatency,
				severity:  "warning",
				message:   fmt.Sprintf("转发规则 [%s] 高延迟 (%dms)", rule.Name, latency),
				details: map[string]interface{}{
					"node_id":   stat.NodeID,
					"rule_id":   stat.RuleID,
					"latency":   latency,
					"threshold": cfg.HighLatencyThreshold,
					"timestamp": time.Now().UTC(),
				},
				emoji: "⏱️",
			})
		}
	}

	if cfg.TrafficSpikeEnabled {
		if spike := checkTrafficSpike(stat, cfg.TrafficSpikeThreshold); spike {
			candidates = append(candidates, alertCandidate{
				alertType: "traffic_spike",
				eventType: messageevent.ForwardTrafficSpike,
				severity:  "warning",
				message:   fmt.Sprintf("转发规则 [%s] 流量突增", rule.Name),
				details: map[string]interface{}{
					"node_id":   stat.NodeID,
					"rule_id":   stat.RuleID,
					"bytes":     stat.TrafficInBytes + stat.TrafficOutBytes,
					"threshold": cfg.TrafficSpikeThreshold,
					"timestamp": time.Now().UTC(),
				},
				emoji: "🚀",
			})
		}
	}

	return candidates
}

func sendForwardAlert(rule *models.ForwardRule, cand alertCandidate) error {
	if rule == nil {
		return nil
	}
	detailsJSON, _ := json.Marshal(cand.details)
	eventType := cand.eventType
	if eventType == "" {
		eventType = cand.alertType
	}
	event := models.EventMessage{
		Event:   eventType,
		Time:    time.Now(),
		Message: cand.message,
		Emoji:   cand.emoji,
	}
	_ = messageSender.SendEvent(event)
	history := &models.ForwardAlertHistory{
		RuleID:    rule.ID,
		AlertType: cand.alertType,
		Severity:  cand.severity,
		Message:   cand.message,
		Details:   string(detailsJSON),
		CreatedAt: models.FromTime(time.Now()),
	}
	return dbforward.CreateAlertHistory(history)
}

func shouldSuppressAlert(ruleID uint, alertType string) bool {
	last, err := dbforward.GetLatestAlertByType(ruleID, alertType)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return false
		}
		return false
	}
	if !last.CreatedAt.ToTime().IsZero() && time.Since(last.CreatedAt.ToTime()) < alertDedupWindow {
		return true
	}
	if last.AcknowledgedAt != nil && !last.AcknowledgedAt.ToTime().IsZero() && time.Since(last.AcknowledgedAt.ToTime()) < alertAckSilence {
		return true
	}
	return false
}

func parseLatency(raw string, key string) (int64, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0, false
	}
	var data map[string]int64
	if err := json.Unmarshal([]byte(raw), &data); err != nil {
		return 0, false
	}
	if v, ok := data[key]; ok {
		return v, true
	}
	for _, v := range data {
		return v, true
	}
	return 0, false
}

// 基于最近样本做简单倍数判断
func checkTrafficSpike(stat *models.ForwardStat, threshold float64) bool {
	if stat == nil {
		return false
	}
	if threshold <= 1 {
		threshold = 2.0
	}
	history, err := GetRecentTrafficHistory(stat.RuleID, stat.NodeID, 10)
	if err != nil || len(history) < 2 {
		return false
	}
	var deltas []int64
	for i := 1; i < len(history); i++ {
		prev := history[i-1].TrafficInBytes + history[i-1].TrafficOutBytes
		cur := history[i].TrafficInBytes + history[i].TrafficOutBytes
		if cur >= prev {
			deltas = append(deltas, cur-prev)
		}
	}
	if len(deltas) == 0 {
		return false
	}
	var sum int64
	for _, d := range deltas {
		sum += d
	}
	avg := sum / int64(len(deltas))
	if avg == 0 {
		return false
	}
	currentTotal := stat.TrafficInBytes + stat.TrafficOutBytes
	last := history[len(history)-1].TrafficInBytes + history[len(history)-1].TrafficOutBytes
	if currentTotal < last {
		return false
	}
	return float64(currentTotal-last) > float64(avg)*threshold
}
