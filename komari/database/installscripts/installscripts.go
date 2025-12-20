package installscripts

import (
	"errors"

	"github.com/komari-monitor/komari/database/dbcore"
	"github.com/komari-monitor/komari/database/models"
	"gorm.io/gorm"
)

func EnsureDefaults() error {
	db := dbcore.GetDBInstance()

	// 兼容老版本：首次升级时自动写入默认脚本；若缺失单个脚本也会补齐
	defaults := []models.InstallScript{
		{Name: "install.sh", Body: defaultInstallSh},
		{Name: "install.ps1", Body: defaultInstallPs1},
	}
	for _, d := range defaults {
		var existing models.InstallScript
		err := db.Where("name = ?", d.Name).First(&existing).Error
		if err == nil {
			continue
		}
		if errors.Is(err, gorm.ErrRecordNotFound) {
			if err := db.Create(&d).Error; err != nil {
				return err
			}
			continue
		}
		return err
	}
	return nil
}

func GetByName(name string) (*models.InstallScript, error) {
	db := dbcore.GetDBInstance()
	var s models.InstallScript
	if err := db.Where("name = ?", name).First(&s).Error; err != nil {
		return nil, err
	}
	return &s, nil
}

func Upsert(name, body string) (*models.InstallScript, error) {
	db := dbcore.GetDBInstance()
	var s models.InstallScript
	err := db.Where("name = ?", name).First(&s).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		s = models.InstallScript{Name: name, Body: body}
		if err := db.Create(&s).Error; err != nil {
			return nil, err
		}
		return &s, nil
	}
	s.Body = body
	if err := db.Save(&s).Error; err != nil {
		return nil, err
	}
	return &s, nil
}

func List() ([]models.InstallScript, error) {
	db := dbcore.GetDBInstance()
	var list []models.InstallScript
	if err := db.Order("name asc").Find(&list).Error; err != nil {
		return nil, err
	}
	return list, nil
}
