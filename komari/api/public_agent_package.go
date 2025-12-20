package api

import (
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/komari-monitor/komari/database/agentversion"
	"github.com/komari-monitor/komari/database/clients"
	"github.com/komari-monitor/komari/database/models"
	"gorm.io/gorm"
)

// DownloadAgentPackagePublic 给部署脚本使用：通过 token + 平台信息下载当前/指定版本 Agent 包
func DownloadAgentPackagePublic(c *gin.Context) {
	token := strings.TrimSpace(c.Query("token"))
	if token == "" {
		RespondError(c, http.StatusUnauthorized, "缺少 token")
		return
	}
	if _, err := clients.GetClientUUIDByToken(token); err != nil {
		RespondError(c, http.StatusUnauthorized, "无效的 token")
		return
	}

	osName := strings.TrimSpace(c.Query("os"))
	arch := strings.TrimSpace(c.Query("arch"))
	if osName == "" || arch == "" {
		RespondError(c, http.StatusBadRequest, "缺少平台信息（os/arch）")
		return
	}

	versionName := strings.TrimSpace(c.Query("version"))
	var version *models.AgentVersion
	var err error
	if versionName == "" || strings.EqualFold(versionName, "current") || strings.EqualFold(versionName, "latest") {
		version, err = agentversion.GetCurrentVersion()
	} else {
		version, err = agentversion.GetVersionByName(versionName)
	}
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			RespondError(c, http.StatusNotFound, "找不到可用的 Agent 版本")
			return
		}
		RespondError(c, http.StatusInternalServerError, "获取版本失败: "+err.Error())
		return
	}

	pkg, err := agentversion.GetPackageByPlatform(version.ID, osName, arch)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			RespondError(c, http.StatusNotFound, "该平台无可用包")
			return
		}
		RespondError(c, http.StatusInternalServerError, "获取包信息失败: "+err.Error())
		return
	}

	path := filepath.Join(agentversion.VersionDir(version.Version), pkg.FileName)
	if _, err := os.Stat(path); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			RespondError(c, http.StatusNotFound, "文件不存在")
			return
		}
		RespondError(c, http.StatusInternalServerError, "读取文件失败: "+err.Error())
		return
	}
	c.FileAttachment(path, pkg.FileName)
}
