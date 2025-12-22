package forward

import (
	"strings"

	"github.com/komari-monitor/komari/database/dbcore"
	"github.com/komari-monitor/komari/database/models"
)

func normalizePlatform(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

// ListRealmBinaries 返回所有 Realm 二进制记录
func ListRealmBinaries() ([]models.RealmBinary, error) {
	db := dbcore.GetDBInstance()
	var items []models.RealmBinary
	if err := db.Order("uploaded_at desc").Find(&items).Error; err != nil {
		return nil, err
	}
	return items, nil
}

func GetRealmBinary(id uint) (*models.RealmBinary, error) {
	db := dbcore.GetDBInstance()
	var item models.RealmBinary
	if err := db.First(&item, id).Error; err != nil {
		return nil, err
	}
	return &item, nil
}

func CreateRealmBinary(item *models.RealmBinary) error {
	if item == nil {
		return nil
	}
	item.OS = normalizePlatform(item.OS)
	item.Arch = normalizePlatform(item.Arch)
	return dbcore.GetDBInstance().Create(item).Error
}

func DeleteRealmBinary(id uint) error {
	return dbcore.GetDBInstance().Delete(&models.RealmBinary{}, id).Error
}

// GetRealmBinaryByPlatform 获取指定平台二进制（优先默认版本）
func GetRealmBinaryByPlatform(osName, arch, version string) (*models.RealmBinary, error) {
	db := dbcore.GetDBInstance()
	osName = normalizePlatform(osName)
	arch = normalizePlatform(arch)
	var item models.RealmBinary
	if version != "" {
		if err := db.Where("os = ? AND arch = ? AND version = ?", osName, arch, version).
			First(&item).Error; err != nil {
			return nil, err
		}
		return &item, nil
	}
	if err := db.Where("os = ? AND arch = ? AND is_default = ?", osName, arch, true).
		Order("uploaded_at desc").
		First(&item).Error; err == nil {
		return &item, nil
	}
	if err := db.Where("os = ? AND arch = ?", osName, arch).
		Order("uploaded_at desc").
		First(&item).Error; err != nil {
		return nil, err
	}
	return &item, nil
}

// ResetRealmBinaryDefault 清除同平台默认标记
func ResetRealmBinaryDefault(osName, arch string) error {
	db := dbcore.GetDBInstance()
	return db.Model(&models.RealmBinary{}).
		Where("os = ? AND arch = ?", normalizePlatform(osName), normalizePlatform(arch)).
		Update("is_default", false).Error
}

// SetRealmBinaryDefault 设置指定记录为默认
func SetRealmBinaryDefault(id uint) error {
	db := dbcore.GetDBInstance()
	var item models.RealmBinary
	if err := db.First(&item, id).Error; err != nil {
		return err
	}
	if err := ResetRealmBinaryDefault(item.OS, item.Arch); err != nil {
		return err
	}
	return db.Model(&models.RealmBinary{}).Where("id = ?", id).Update("is_default", true).Error
}

// ExistsRealmBinary 校验同平台版本是否已存在
func ExistsRealmBinary(osName, arch, version string) (bool, error) {
	db := dbcore.GetDBInstance()
	var count int64
	err := db.Model(&models.RealmBinary{}).
		Where("os = ? AND arch = ? AND version = ?", normalizePlatform(osName), normalizePlatform(arch), strings.TrimSpace(version)).
		Count(&count).Error
	if err != nil {
		return false, err
	}
	return count > 0, nil
}
