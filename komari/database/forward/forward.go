package forward

import (
	"errors"

	"github.com/komari-monitor/komari/database/dbcore"
	"github.com/komari-monitor/komari/database/models"
	"gorm.io/gorm"
)

func ListForwardRules() ([]models.ForwardRule, error) {
	var rules []models.ForwardRule
	if err := dbcore.GetDBInstance().Order("sort_order ASC, id ASC").Find(&rules).Error; err != nil {
		return nil, err
	}
	return rules, nil
}

func GetForwardRule(id uint) (*models.ForwardRule, error) {
	var rule models.ForwardRule
	if err := dbcore.GetDBInstance().First(&rule, id).Error; err != nil {
		return nil, err
	}
	return &rule, nil
}

func CreateForwardRule(rule *models.ForwardRule) error {
	return dbcore.GetDBInstance().Create(rule).Error
}

func UpdateForwardRule(id uint, updates map[string]interface{}) error {
	if len(updates) == 0 {
		return nil
	}
	return dbcore.GetDBInstance().Model(&models.ForwardRule{}).Where("id = ?", id).Updates(updates).Error
}

func DeleteForwardRule(id uint) error {
	return dbcore.GetDBInstance().Where("id = ?", id).Delete(&models.ForwardRule{}).Error
}

// Alert config
func GetAlertConfig(ruleID uint) (*models.ForwardAlertConfig, error) {
	db := dbcore.GetDBInstance()
	var cfg models.ForwardAlertConfig
	if err := db.Where("rule_id = ?", ruleID).First(&cfg).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			cfg = models.ForwardAlertConfig{
				RuleID: ruleID,
			}
			if createErr := db.Create(&cfg).Error; createErr != nil {
				return nil, createErr
			}
			return &cfg, nil
		}
		return nil, err
	}
	return &cfg, nil
}

func UpdateAlertConfig(ruleID uint, cfg *models.ForwardAlertConfig) error {
	cfg.RuleID = ruleID
	return dbcore.GetDBInstance().Where("rule_id = ?", ruleID).Save(cfg).Error
}

// System settings
func GetSystemSettings() (*models.ForwardSystemSettings, error) {
	var settings models.ForwardSystemSettings
	if err := dbcore.GetDBInstance().First(&settings, 1).Error; err != nil {
		return nil, err
	}
	return &settings, nil
}

func UpdateSystemSettings(settings *models.ForwardSystemSettings) error {
	settings.ID = 1
	return dbcore.GetDBInstance().Save(settings).Error
}

// Realm config template
func GetRealmConfigTemplate() (*models.RealmConfigTemplate, error) {
	var tmpl models.RealmConfigTemplate
	if err := dbcore.GetDBInstance().First(&tmpl, 1).Error; err != nil {
		return nil, err
	}
	return &tmpl, nil
}

func UpdateRealmConfigTemplate(tmpl *models.RealmConfigTemplate) error {
	if tmpl.ID == 0 {
		tmpl.ID = 1
	}
	if tmpl.TemplateToml == "" {
		return errors.New("template_toml is empty")
	}
	return dbcore.GetDBInstance().Save(tmpl).Error
}
