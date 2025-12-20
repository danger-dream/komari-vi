package lg

import (
	"time"

	"github.com/komari-monitor/komari/database/dbcore"
	"github.com/komari-monitor/komari/database/models"
	"gorm.io/gorm/clause"
)

func defaultToolSettings() map[string]models.LgToolSetting {
	return map[string]models.LgToolSetting{
		"ping": {
			Tool:            "ping",
			CommandTemplate: "ping -c 10 $INPUT",
			TimeoutSeconds:  30,
		},
		"tcping": {
			Tool:            "tcping",
			CommandTemplate: "tcping -n 10 $INPUT",
			TimeoutSeconds:  30,
		},
		"mtr": {
			Tool:            "mtr",
			CommandTemplate: "mtr -c 10 $INPUT",
			TimeoutSeconds:  45,
		},
		"nexttrace": {
			Tool:            "nexttrace",
			CommandTemplate: "nexttrace -f 1 -4 -M $INPUT",
			TimeoutSeconds:  60,
		},
		"iperf3": {
			Tool:            "iperf3",
			CommandTemplate: "iperf3 -s -p $PORT",
			TimeoutSeconds:  120,
		},
		"speedtest": {
			Tool:            "speedtest",
			CommandTemplate: "speedtest -s $INPUT",
			TimeoutSeconds:  120,
		},
	}
}

func EnsureDefaultToolSettings() error {
	db := dbcore.GetDBInstance()
	defaults := defaultToolSettings()
	now := models.FromTime(time.Now())
	for _, setting := range defaults {
		setting.CreatedAt = now
		setting.UpdatedAt = now
		// 只在不存在时插入，避免覆盖用户自定义配置
		var count int64
		if err := db.Model(&models.LgToolSetting{}).Where("tool = ?", setting.Tool).Count(&count).Error; err != nil {
			return err
		}
		if count == 0 {
			if err := db.Create(&setting).Error; err != nil {
				return err
			}
		}
	}
	return nil
}

func ListToolSettings() ([]models.LgToolSetting, error) {
	var settings []models.LgToolSetting
	if err := dbcore.GetDBInstance().Order("tool asc").Find(&settings).Error; err != nil {
		return nil, err
	}
	return settings, nil
}

func UpsertToolSettings(settings []models.LgToolSetting) error {
	db := dbcore.GetDBInstance()
	now := models.FromTime(time.Now())
	for _, s := range settings {
		if err := ValidateTool(s.Tool); err != nil {
			return err
		}
		if s.TimeoutSeconds <= 0 {
			s.TimeoutSeconds = 30
		}
		s.UpdatedAt = now
		if s.ID == 0 {
			s.CreatedAt = now
		}
		if err := db.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "tool"}},
			DoUpdates: clause.Assignments(map[string]interface{}{"command_template": s.CommandTemplate, "timeout_seconds": s.TimeoutSeconds, "updated_at": s.UpdatedAt}),
		}).Create(&s).Error; err != nil {
			return err
		}
	}
	return nil
}

func GetToolSetting(tool string) (*models.LgToolSetting, error) {
	var s models.LgToolSetting
	if err := dbcore.GetDBInstance().Where("tool = ?", tool).First(&s).Error; err != nil {
		return nil, err
	}
	return &s, nil
}
