package script

import (
	"github.com/komari-monitor/komari/database/dbcore"
	"github.com/komari-monitor/komari/database/models"
	"gorm.io/gorm"
)

func GetAllFolders() ([]models.ScriptFolder, error) {
	var folders []models.ScriptFolder
	if err := dbcore.GetDBInstance().Order("`order` asc, id asc").Find(&folders).Error; err != nil {
		return nil, err
	}
	return folders, nil
}

func AddFolder(folder *models.ScriptFolder) error {
	return dbcore.GetDBInstance().Create(folder).Error
}

func UpdateFolder(folder *models.ScriptFolder) error {
	updates := map[string]any{
		"name":       folder.Name,
		"parent_id":  folder.ParentID,
		"icon":       folder.Icon,
		"order":      folder.Order,
		"updated_at": models.Now(),
	}
	return dbcore.GetDBInstance().Model(&models.ScriptFolder{}).Where("id = ?", folder.ID).Updates(updates).Error
}

func DeleteFolder(id uint) error {
	return dbcore.GetDBInstance().Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("id = ?", id).Delete(&models.ScriptFolder{}).Error; err != nil {
			return err
		}
		// 将所属脚本移到根目录，避免孤立引用
		return tx.Model(&models.Script{}).Where("folder_id = ?", id).Update("folder_id", nil).Error
	})
}
