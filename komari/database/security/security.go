package security

import (
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/komari-monitor/komari/database/dbcore"
	"github.com/komari-monitor/komari/database/models"
	"github.com/komari-monitor/komari/utils"
	"gorm.io/gorm"
)

var (
	cacheMu     sync.RWMutex
	cachedCfg   *models.SecurityConfig
	lastUpdated time.Time
)

func defaultSecurityConfig() models.SecurityConfig {
	return models.SecurityConfig{
		SignatureEnabled:    false,
		SignatureSecret:     utils.GenerateRandomString(32),
		SignatureTTL:        300,
		NonceTTL:            300,
		NonceCacheSize:      2000,
		RequireOrigin:       false,
		AllowedOrigins:      []string{},
		AllowedReferers:     []string{},
		RatePublicPerMin:    60,
		RateVerifyPerMin:    30,
		RateStartPerMin:     20,
		MaxFailuresPerIP:    5,
		FailureLockMinutes:  30,
		FailureWindowSecond: 1800,
	}
}

// EnsureSecurityConfig 确保有一条安全配置记录
func EnsureSecurityConfig() error {
	db := dbcore.GetDBInstance()
	var cfg models.SecurityConfig
	err := db.First(&cfg).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		cfg = defaultSecurityConfig()
		now := models.FromTime(time.Now())
		cfg.CreatedAt = now
		cfg.UpdatedAt = now
		return db.Create(&cfg).Error
	}
	return err
}

// GetSecurityConfig 获取安全配置（带缓存）
func GetSecurityConfig() (*models.SecurityConfig, error) {
	cacheMu.RLock()
	if cachedCfg != nil && time.Since(lastUpdated) < time.Minute {
		defer cacheMu.RUnlock()
		copy := *cachedCfg
		return &copy, nil
	}
	cacheMu.RUnlock()

	db := dbcore.GetDBInstance()
	var cfg models.SecurityConfig
	if err := db.First(&cfg).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			if err := EnsureSecurityConfig(); err != nil {
				return nil, err
			}
			return GetSecurityConfig()
		}
		return nil, err
	}
	cacheMu.Lock()
	cachedCfg = &cfg
	lastUpdated = time.Now()
	cacheMu.Unlock()
	return &cfg, nil
}

// UpdateSecurityConfig 保存配置并刷新缓存
func UpdateSecurityConfig(input *models.SecurityConfig) error {
	// 保留已有密钥
	if strings.Contains(input.SignatureSecret, "***") {
		if current, err := GetSecurityConfig(); err == nil {
			input.SignatureSecret = current.SignatureSecret
		} else {
			input.SignatureSecret = ""
		}
	}
	if input.SignatureTTL < 30 {
		input.SignatureTTL = 30
	}
	if input.NonceTTL < 30 {
		input.NonceTTL = 30
	}
	if input.NonceCacheSize < 100 {
		input.NonceCacheSize = 100
	}
	if input.RatePublicPerMin < 0 {
		input.RatePublicPerMin = 0
	}
	if input.RateVerifyPerMin < 0 {
		input.RateVerifyPerMin = 0
	}
	if input.RateStartPerMin < 0 {
		input.RateStartPerMin = 0
	}
	if input.MaxFailuresPerIP < 0 {
		input.MaxFailuresPerIP = 0
	}
	if input.FailureLockMinutes < 0 {
		input.FailureLockMinutes = 0
	}
	if input.FailureWindowSecond < 0 {
		input.FailureWindowSecond = 0
	}
	if input.SignatureEnabled && input.SignatureSecret == "" {
		input.SignatureSecret = utils.GenerateRandomString(32)
	}

	db := dbcore.GetDBInstance()
	now := models.FromTime(time.Now())
	input.UpdatedAt = now

	err := db.Transaction(func(tx *gorm.DB) error {
		var existing models.SecurityConfig
		if err := tx.First(&existing).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				input.CreatedAt = now
				return tx.Create(input).Error
			}
			return err
		}
		input.ID = existing.ID
		return tx.Model(&models.SecurityConfig{}).Where("id = ?", existing.ID).Updates(input).Error
	})
	if err != nil {
		return err
	}
	cacheMu.Lock()
	copy := *input
	cachedCfg = &copy
	lastUpdated = time.Now()
	cacheMu.Unlock()
	return nil
}

func MaskedSecret(cfg *models.SecurityConfig) string {
	if cfg.SignatureSecret == "" {
		return ""
	}
	if len(cfg.SignatureSecret) <= 6 {
		return "***"
	}
	return fmt.Sprintf("%s***%s", cfg.SignatureSecret[:3], cfg.SignatureSecret[len(cfg.SignatureSecret)-3:])
}
