package script

import (
	"errors"
	"strings"

	"github.com/komari-monitor/komari/database/dbcore"
	"github.com/komari-monitor/komari/database/models"
	"gorm.io/gorm"
)

func GetVariables(scope string, scriptID *uint, clientUUID *string) ([]models.ScriptVariable, error) {
	db := dbcore.GetDBInstance()
	var vars []models.ScriptVariable
	q := db.Where("scope = ?", scope)
	if scriptID != nil {
		q = q.Where("script_id = ?", *scriptID)
	} else {
		q = q.Where("script_id IS NULL")
	}
	if clientUUID != nil && *clientUUID != "" {
		q = q.Where("client_uuid = ?", *clientUUID)
	} else {
		q = q.Where("client_uuid IS NULL")
	}
	if err := q.Order("updated_at desc").Find(&vars).Error; err != nil {
		return nil, err
	}
	return vars, nil
}

func GetVariable(scope string, scriptID *uint, clientUUID *string, key string) (*models.ScriptVariable, error) {
	db := dbcore.GetDBInstance()
	var v models.ScriptVariable
	q := db.Where("scope = ? AND key = ?", scope, key)
	if scriptID != nil {
		q = q.Where("script_id = ?", *scriptID)
	} else {
		q = q.Where("script_id IS NULL")
	}
	if clientUUID != nil && *clientUUID != "" {
		q = q.Where("client_uuid = ?", *clientUUID)
	} else {
		q = q.Where("client_uuid IS NULL")
	}
	err := q.First(&v).Error
	if err != nil {
		return nil, err
	}
	return &v, nil
}

func SetVariable(scope string, scriptID *uint, clientUUID *string, key, value, valueType, operator string) error {
	scope = strings.ToLower(scope)
	if scope == "" || key == "" {
		return errors.New("scope and key are required")
	}
	db := dbcore.GetDBInstance()
	now := models.Now()
	var existing models.ScriptVariable
	q := db.Where("scope = ? AND key = ?", scope, key)
	if scriptID != nil {
		q = q.Where("script_id = ?", *scriptID)
	} else {
		q = q.Where("script_id IS NULL")
	}
	if clientUUID != nil && *clientUUID != "" {
		q = q.Where("client_uuid = ?", *clientUUID)
	} else {
		q = q.Where("client_uuid IS NULL")
	}
	err := q.First(&existing).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		newVar := models.ScriptVariable{
			Scope:           scope,
			ScriptID:        scriptID,
			ClientUUID:      clientUUID,
			Key:             key,
			Value:           value,
			ValueType:       valueType,
			CreatedByClient: operator,
			UpdatedByClient: operator,
			CreatedAt:       now,
			UpdatedAt:       now,
		}
		return db.Create(&newVar).Error
	}
	if err != nil {
		return err
	}
	return db.Model(&models.ScriptVariable{}).
		Where("id = ?", existing.ID).
		Updates(map[string]any{
			"value":             value,
			"value_type":        valueType,
			"updated_by_client": operator,
			"updated_at":        now,
		}).Error
}

func DeleteVariable(id uint) error {
	return dbcore.GetDBInstance().Where("id = ?", id).Delete(&models.ScriptVariable{}).Error
}
