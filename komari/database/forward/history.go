package forward

import (
	"time"

	"github.com/komari-monitor/komari/database/dbcore"
	"github.com/komari-monitor/komari/database/models"
)

// UpsertTrafficHistory 写入/更新历史统计（按 rule_id + node_id + timestamp 聚合）
func UpsertTrafficHistory(entry *models.ForwardTrafficHistory) error {
	if entry == nil {
		return nil
	}
	db := dbcore.GetDBInstance()
	return db.Where("rule_id = ? AND node_id = ? AND timestamp = ?", entry.RuleID, entry.NodeID, entry.Timestamp).
		Assign(entry).
		FirstOrCreate(entry).Error
}

// ListTrafficHistory 获取指定规则的历史数据（可选 node_id）
func ListTrafficHistory(ruleID uint, nodeID string, limit int) ([]models.ForwardTrafficHistory, error) {
	db := dbcore.GetDBInstance()
	var items []models.ForwardTrafficHistory
	query := db.Where("rule_id = ?", ruleID)
	if nodeID != "" {
		query = query.Where("node_id = ?", nodeID)
	}
	if limit > 0 {
		query = query.Limit(limit)
	}
	if err := query.Order("timestamp desc").Find(&items).Error; err != nil {
		return nil, err
	}
	// 按时间升序返回，方便前端绘图
	for i, j := 0, len(items)-1; i < j; i, j = i+1, j-1 {
		items[i], items[j] = items[j], items[i]
	}
	return items, nil
}

// ListTrafficHistorySince 获取指定规则在时间点后的历史数据
func ListTrafficHistorySince(ruleID uint, nodeID string, since time.Time, limit int) ([]models.ForwardTrafficHistory, error) {
	db := dbcore.GetDBInstance()
	var items []models.ForwardTrafficHistory
	query := db.Where("rule_id = ? AND timestamp >= ?", ruleID, models.FromTime(since))
	if nodeID != "" {
		query = query.Where("node_id = ?", nodeID)
	}
	if limit > 0 {
		query = query.Limit(limit)
	}
	if err := query.Order("timestamp asc").Find(&items).Error; err != nil {
		return nil, err
	}
	return items, nil
}
