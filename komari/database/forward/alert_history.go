package forward

import (
	"time"

	"github.com/komari-monitor/komari/database/dbcore"
	"github.com/komari-monitor/komari/database/models"
)

func CreateAlertHistory(entry *models.ForwardAlertHistory) error {
	if entry == nil {
		return nil
	}
	return dbcore.GetDBInstance().Create(entry).Error
}

func ListAlertHistory(ruleID uint, limit int) ([]models.ForwardAlertHistory, error) {
	db := dbcore.GetDBInstance()
	var items []models.ForwardAlertHistory
	query := db.Where("rule_id = ?", ruleID)
	if limit > 0 {
		query = query.Limit(limit)
	}
	if err := query.Order("created_at desc").Find(&items).Error; err != nil {
		return nil, err
	}
	return items, nil
}

func GetLatestAlertByType(ruleID uint, alertType string) (*models.ForwardAlertHistory, error) {
	db := dbcore.GetDBInstance()
	var item models.ForwardAlertHistory
	if err := db.Where("rule_id = ? AND alert_type = ?", ruleID, alertType).
		Order("created_at desc").
		First(&item).Error; err != nil {
		return nil, err
	}
	return &item, nil
}

func AcknowledgeAlert(ruleID uint, alertID uint, by string) error {
	now := models.FromTime(time.Now())
	return dbcore.GetDBInstance().
		Model(&models.ForwardAlertHistory{}).
		Where("id = ? AND rule_id = ?", alertID, ruleID).
		Updates(map[string]interface{}{
			"acknowledged":    true,
			"acknowledged_at": &now,
			"acknowledged_by": by,
		}).Error
}
