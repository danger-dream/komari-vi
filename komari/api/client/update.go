package client

import (
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/komari-monitor/komari/api"
	"github.com/komari-monitor/komari/database/agentversion"
	"github.com/komari-monitor/komari/database/clients"
	"github.com/komari-monitor/komari/database/dbcore"
	"github.com/komari-monitor/komari/database/models"
	"gorm.io/gorm"
)

func normalizeVersionString(v string) string {
	v = strings.TrimSpace(v)
	v = strings.TrimPrefix(v, "v")
	v = strings.TrimPrefix(v, "V")
	return v
}

// GetAgentUpdate 返回当前最新可用版本
func GetAgentUpdate(c *gin.Context) {
	token := c.Query("token")
	currentVersion := c.Query("current_version")
	osName := c.Query("os")
	arch := c.Query("arch")

	clientUUID, err := clients.GetClientUUIDByToken(token)
	if err != nil {
		api.RespondError(c, http.StatusUnauthorized, "无效的 token")
		return
	}

	if osName == "" || arch == "" {
		db := dbcore.GetDBInstance()
		var cli models.Client
		if err := db.Where("uuid = ?", clientUUID).First(&cli).Error; err == nil {
			if osName == "" {
				osName = cli.OS
			}
			if arch == "" {
				arch = cli.Arch
			}
		}
	}
	if osName == "" || arch == "" {
		api.RespondError(c, http.StatusBadRequest, "缺少平台信息（os/arch）")
		return
	}

	version, err := agentversion.GetCurrentVersion()
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			api.RespondSuccess(c, gin.H{
				"has_update": false,
				"reason":     "no_current_version",
			})
			return
		}
		api.RespondError(c, http.StatusInternalServerError, "获取版本信息失败: "+err.Error())
		return
	}

	pkg, err := agentversion.GetPackageByPlatform(version.ID, osName, arch)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			api.RespondSuccess(c, gin.H{
				"has_update": false,
				"reason":     "no_package_for_platform",
				"version":    version.Version,
			})
			return
		}
		api.RespondError(c, http.StatusInternalServerError, "获取包信息失败: "+err.Error())
		return
	}

	needUpdate := version.IsCurrent && normalizeVersionString(version.Version) != normalizeVersionString(currentVersion)
	api.RespondSuccess(c, gin.H{
		"has_update":    needUpdate,
		"version":       version.Version,
		"is_current":    version.IsCurrent,
		"changelog":     version.Changelog,
		"package_id":    pkg.ID,
		"download_path": fmt.Sprintf("/api/clients/package/%d", pkg.ID),
		"os":            pkg.OS,
		"arch":          pkg.Arch,
		"hash":          pkg.Hash,
		"file_size":     pkg.FileSize,
	})
}

// DownloadAgentPackage 提供 Agent 更新文件下载
func DownloadAgentPackage(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		api.RespondError(c, http.StatusBadRequest, "无效的包ID")
		return
	}
	pkg, err := agentversion.GetPackageByID(uint(id))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			api.RespondError(c, http.StatusNotFound, "包不存在")
			return
		}
		api.RespondError(c, http.StatusInternalServerError, "获取包信息失败: "+err.Error())
		return
	}
	version, err := agentversion.GetVersionByID(pkg.VersionID)
	if err != nil {
		api.RespondError(c, http.StatusInternalServerError, "获取版本信息失败: "+err.Error())
		return
	}
	path := filepath.Join(agentversion.VersionDir(version.Version), pkg.FileName)
	if _, err := os.Stat(path); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			api.RespondError(c, http.StatusNotFound, "文件不存在")
			return
		}
		api.RespondError(c, http.StatusInternalServerError, "读取文件失败: "+err.Error())
		return
	}
	c.FileAttachment(path, pkg.FileName)
}
