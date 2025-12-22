package forward

import (
	"encoding/json"
	"strings"
	"time"

	dbforward "github.com/komari-monitor/komari/database/forward"
	"github.com/komari-monitor/komari/database/models"
)

var defaultHistoryLimit = 300

// RecordTrafficHistory 将实时统计写入历史表（按系统设置聚合）
func RecordTrafficHistory(stat *models.ForwardStat) {
	if stat == nil {
		return
	}
	settings, err := dbforward.GetSystemSettings()
	if err != nil {
		return
	}
	bucket := bucketTime(time.Now(), settings.HistoryAggregatePeriod)
	entry := &models.ForwardTrafficHistory{
		RuleID:          stat.RuleID,
		NodeID:          stat.NodeID,
		Timestamp:       models.FromTime(bucket),
		Connections:     stat.ActiveConnections,
		TrafficInBytes:  stat.TrafficInBytes,
		TrafficOutBytes: stat.TrafficOutBytes,
		AvgLatencyMs:    int(extractLatency(stat.NodesLatency)),
	}
	_ = dbforward.UpsertTrafficHistory(entry)
}

func bucketTime(ts time.Time, period string) time.Time {
	switch strings.ToLower(strings.TrimSpace(period)) {
	case "10min":
		return ts.Truncate(10 * time.Minute)
	case "30min":
		return ts.Truncate(30 * time.Minute)
	case "1hour", "hour":
		return ts.Truncate(time.Hour)
	case "1day", "day":
		return time.Date(ts.Year(), ts.Month(), ts.Day(), 0, 0, 0, 0, ts.Location())
	default:
		return ts.Truncate(time.Hour)
	}
}

func extractLatency(raw string) int64 {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0
	}
	var data map[string]int64
	if err := json.Unmarshal([]byte(raw), &data); err != nil {
		return 0
	}
	if v, ok := data["self"]; ok {
		return v
	}
	var sum int64
	for _, v := range data {
		sum += v
	}
	if len(data) == 0 {
		return 0
	}
	return sum / int64(len(data))
}

// GetRecentTrafficHistory 提供给 API 使用的历史数据读取
func GetRecentTrafficHistory(ruleID uint, nodeID string, limit int) ([]models.ForwardTrafficHistory, error) {
	if limit <= 0 {
		limit = defaultHistoryLimit
	}
	return dbforward.ListTrafficHistory(ruleID, nodeID, limit)
}
