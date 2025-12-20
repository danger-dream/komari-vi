package script

import (
	"errors"

	"github.com/komari-monitor/komari/database/dbcore"
	"github.com/komari-monitor/komari/database/models"
	"gorm.io/gorm"
)

func GetAllScripts() ([]models.Script, error) {
	var scripts []models.Script
	if err := dbcore.GetDBInstance().Order("`order` asc, id asc").Find(&scripts).Error; err != nil {
		return nil, err
	}
	return scripts, nil
}

func GetScriptByID(id uint) (*models.Script, error) {
	var s models.Script
	if err := dbcore.GetDBInstance().Where("id = ?", id).First(&s).Error; err != nil {
		return nil, err
	}
	return &s, nil
}

func CreateScript(s *models.Script) error {
	return dbcore.GetDBInstance().Create(s).Error
}

func UpdateScripts(scripts []*models.Script) error {
	db := dbcore.GetDBInstance()
	for _, s := range scripts {
		if s == nil {
			continue
		}
		updates := map[string]any{
			"folder_id":          s.FolderID,
			"order":              s.Order,
			"name":               s.Name,
			"enabled":            s.Enabled,
			"clients":            s.Clients,
			"client_status":      s.ClientStatus,
			"script_body":        s.ScriptBody,
			"timeout_sec":        s.TimeoutSec,
			"trigger_kind":       s.TriggerKind,
			"cron_expr":          s.CronExpr,
			"trigger_name":       s.TriggerName,
			"message_type":       s.MessageType,
			"depends_on_scripts": s.DependsOnScripts,
			"depends_on_folders": s.DependsOnFolders,
			"updated_at":         models.Now(),
		}
		result := db.Model(&models.Script{}).Where("id = ?", s.ID).Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}
	}
	return nil
}

func DeleteScript(id uint) error {
	result := dbcore.GetDBInstance().Where("id = ?", id).Delete(&models.Script{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func UpdateClientStatus(scriptID uint, status models.ScriptClientStatusList) error {
	if scriptID == 0 {
		return errors.New("scriptID is required")
	}
	return dbcore.GetDBInstance().Model(&models.Script{}).Where("id = ?", scriptID).Update("client_status", status).Error
}
