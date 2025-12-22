package forward

import (
	"time"

	"github.com/komari-monitor/komari/database/dbcore"
	"github.com/komari-monitor/komari/database/models"
)

func UpsertForwardStat(stat *models.ForwardStat) error {
	db := dbcore.GetDBInstance()
	stat.LastUpdatedAt = models.FromTime(time.Now())
	return db.Where("rule_id = ? AND node_id = ?", stat.RuleID, stat.NodeID).
		Assign(stat).
		FirstOrCreate(stat).Error
}

func GetForwardStats(ruleID uint) ([]models.ForwardStat, error) {
	var stats []models.ForwardStat
	if err := dbcore.GetDBInstance().Where("rule_id = ?", ruleID).Find(&stats).Error; err != nil {
		return nil, err
	}
	return stats, nil
}

func UpdateForwardStatStatus(ruleID uint, nodeID string, status string) error {
	if ruleID == 0 || nodeID == "" || status == "" {
		return nil
	}
	return dbcore.GetDBInstance().
		Model(&models.ForwardStat{}).
		Where("rule_id = ? AND node_id = ?", ruleID, nodeID).
		Updates(map[string]interface{}{
			"link_status":     status,
			"last_updated_at": models.FromTime(time.Now()),
		}).Error
}

func AggregateForwardStats(ruleID uint) (int64, int64, int64, error) {
	var totals struct {
		Connections int64 `gorm:"column:connections"`
		TrafficIn   int64 `gorm:"column:traffic_in"`
		TrafficOut  int64 `gorm:"column:traffic_out"`
	}
	err := dbcore.GetDBInstance().
		Model(&models.ForwardStat{}).
		Select("COALESCE(SUM(active_connections),0) as connections, COALESCE(SUM(traffic_in_bytes),0) as traffic_in, COALESCE(SUM(traffic_out_bytes),0) as traffic_out").
		Where("rule_id = ?", ruleID).
		Scan(&totals).Error
	if err != nil {
		return 0, 0, 0, err
	}
	return totals.Connections, totals.TrafficIn, totals.TrafficOut, nil
}
