package agentversion

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/komari-monitor/komari/database/dbcore"
	"github.com/komari-monitor/komari/database/models"
	"gorm.io/gorm/clause"
)

const packageBaseDir = "./package"

// EnsurePackageDir 确保基础包目录存在
func EnsurePackageDir() error {
	return os.MkdirAll(packageBaseDir, os.ModePerm)
}

// VersionDir 返回指定版本的存储目录
func VersionDir(version string) string {
	return filepath.Join(packageBaseDir, version)
}

// ValidateVersionName 做基础校验，避免路径穿越
func ValidateVersionName(version string) error {
	if version == "" {
		return fmt.Errorf("版本号不能为空")
	}
	if strings.Contains(version, "..") || strings.ContainsAny(version, "/\\") {
		return fmt.Errorf("版本号包含非法字符")
	}
	return nil
}

func normalizePlatform(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

// List 返回所有版本及其包列表
func List() ([]models.AgentVersion, error) {
	db := dbcore.GetDBInstance()
	var versions []models.AgentVersion
	if err := db.Preload("Packages").Order("created_at desc").Find(&versions).Error; err != nil {
		return nil, err
	}
	return versions, nil
}

// GetVersionByID 查询版本信息并加载包列表
func GetVersionByID(id uint) (*models.AgentVersion, error) {
	db := dbcore.GetDBInstance()
	var version models.AgentVersion
	if err := db.Preload("Packages").First(&version, id).Error; err != nil {
		return nil, err
	}
	return &version, nil
}

// GetVersionByName 根据版本号查询版本信息并加载包列表
func GetVersionByName(version string) (*models.AgentVersion, error) {
	db := dbcore.GetDBInstance()
	version = strings.TrimSpace(version)
	var v models.AgentVersion
	if err := db.Preload("Packages").Where("version = ?", version).First(&v).Error; err != nil {
		return nil, err
	}
	return &v, nil
}

// GetPackageByID 根据ID查询包记录
func GetPackageByID(id uint) (*models.AgentPackage, error) {
	db := dbcore.GetDBInstance()
	var pkg models.AgentPackage
	if err := db.First(&pkg, id).Error; err != nil {
		return nil, err
	}
	return &pkg, nil
}

// CreateVersion 创建版本并批量写入包信息
func CreateVersion(version, changelog string, isCurrent bool, packages []models.AgentPackage) (*models.AgentVersion, error) {
	db := dbcore.GetDBInstance()
	version = strings.TrimSpace(version)
	if err := ValidateVersionName(version); err != nil {
		return nil, err
	}
	tx := db.Begin()
	if tx.Error != nil {
		return nil, tx.Error
	}

	newVersion := models.AgentVersion{
		Version:   version,
		Changelog: changelog,
		IsCurrent: isCurrent,
	}
	if err := tx.Create(&newVersion).Error; err != nil {
		tx.Rollback()
		return nil, err
	}
	if isCurrent {
		if err := tx.Model(&models.AgentVersion{}).Where("id <> ?", newVersion.ID).Update("is_current", false).Error; err != nil {
			tx.Rollback()
			return nil, err
		}
	}
	for i := range packages {
		packages[i].VersionID = newVersion.ID
		packages[i].OS = normalizePlatform(packages[i].OS)
		packages[i].Arch = normalizePlatform(packages[i].Arch)
	}
	if len(packages) > 0 {
		if err := tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "version_id"}, {Name: "os"}, {Name: "arch"}},
			DoUpdates: clause.AssignmentColumns([]string{"file_name", "file_size", "hash"}),
		}).Create(&packages).Error; err != nil {
			tx.Rollback()
			return nil, err
		}
	}
	if err := tx.Commit().Error; err != nil {
		return nil, err
	}
	return GetVersionByID(newVersion.ID)
}

// UpdateMetadata 更新版本元信息（支持切换当前版本）
func UpdateMetadata(id uint, version *string, changelog *string, isCurrent *bool) (*models.AgentVersion, error) {
	db := dbcore.GetDBInstance()
	tx := db.Begin()
	if tx.Error != nil {
		return nil, tx.Error
	}
	updates := map[string]any{}
	if version != nil {
		if err := ValidateVersionName(*version); err != nil {
			return nil, err
		}
		updates["version"] = *version
	}
	if changelog != nil {
		updates["changelog"] = *changelog
	}
	if isCurrent != nil {
		updates["is_current"] = *isCurrent
	}
	if len(updates) > 0 {
		if err := tx.Model(&models.AgentVersion{}).Where("id = ?", id).Updates(updates).Error; err != nil {
			tx.Rollback()
			return nil, err
		}
	}
	if isCurrent != nil && *isCurrent {
		if err := tx.Model(&models.AgentVersion{}).Where("id <> ?", id).Update("is_current", false).Error; err != nil {
			tx.Rollback()
			return nil, err
		}
	}
	if err := tx.Commit().Error; err != nil {
		return nil, err
	}
	return GetVersionByID(id)
}

// UpsertPackage 写入或更新单个包信息
func UpsertPackage(pkg models.AgentPackage) error {
	db := dbcore.GetDBInstance()
	pkg.OS = normalizePlatform(pkg.OS)
	pkg.Arch = normalizePlatform(pkg.Arch)
	return db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "version_id"}, {Name: "os"}, {Name: "arch"}},
		DoUpdates: clause.AssignmentColumns([]string{"file_name", "file_size", "hash"}),
	}).Create(&pkg).Error
}

// GetPackageByPlatform 根据平台查找对应包
func GetPackageByPlatform(versionID uint, osName, arch string) (*models.AgentPackage, error) {
	db := dbcore.GetDBInstance()
	var pkg models.AgentPackage
	if err := db.Where("version_id = ? AND os = ? AND arch = ?", versionID, normalizePlatform(osName), normalizePlatform(arch)).First(&pkg).Error; err != nil {
		return nil, err
	}
	return &pkg, nil
}

// GetCurrentVersion 获取标记为当前的版本
func GetCurrentVersion() (*models.AgentVersion, error) {
	db := dbcore.GetDBInstance()
	var version models.AgentVersion
	if err := db.Preload("Packages").Where("is_current = ?", true).Order("updated_at desc").First(&version).Error; err != nil {
		return nil, err
	}
	return &version, nil
}

// DeleteVersion 删除版本及其所有包（会清理磁盘文件）
func DeleteVersion(id uint) error {
	db := dbcore.GetDBInstance()
	version, err := GetVersionByID(id)
	if err != nil {
		return err
	}
	// 删除数据库记录
	tx := db.Begin()
	if tx.Error != nil {
		return tx.Error
	}
	// 先删除包记录
	if err := tx.Where("version_id = ?", id).Delete(&models.AgentPackage{}).Error; err != nil {
		tx.Rollback()
		return err
	}
	// 再删除版本记录
	if err := tx.Delete(&models.AgentVersion{}, id).Error; err != nil {
		tx.Rollback()
		return err
	}
	if err := tx.Commit().Error; err != nil {
		return err
	}
	// 清理磁盘文件
	versionDir := VersionDir(version.Version)
	_ = os.RemoveAll(versionDir)
	return nil
}

// DeletePackage 删除单个包（会清理磁盘文件）
func DeletePackage(packageID uint) error {
	db := dbcore.GetDBInstance()
	pkg, err := GetPackageByID(packageID)
	if err != nil {
		return err
	}
	// 获取版本信息
	version, err := GetVersionByID(pkg.VersionID)
	if err != nil {
		return err
	}
	// 删除数据库记录
	if err := db.Delete(&models.AgentPackage{}, packageID).Error; err != nil {
		return err
	}
	// 清理磁盘文件
	filePath := filepath.Join(VersionDir(version.Version), pkg.FileName)
	_ = os.Remove(filePath)
	return nil
}
