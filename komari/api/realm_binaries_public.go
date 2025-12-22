package api

import (
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/komari-monitor/komari/database/clients"
	dbforward "github.com/komari-monitor/komari/database/forward"
	"gorm.io/gorm"
)

// DownloadRealmBinaryPublic 通过 token + 平台信息下载 Realm 二进制
func DownloadRealmBinaryPublic(c *gin.Context) {
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
	version := strings.TrimSpace(c.Query("version"))
	if osName == "" || arch == "" {
		RespondError(c, http.StatusBadRequest, "缺少平台信息（os/arch）")
		return
	}
	item, err := dbforward.GetRealmBinaryByPlatform(osName, arch, version)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			RespondError(c, http.StatusNotFound, "找不到对应的 Realm 二进制")
			return
		}
		RespondError(c, http.StatusInternalServerError, "获取二进制信息失败: "+err.Error())
		return
	}
	if item.FilePath == "" {
		RespondError(c, http.StatusNotFound, "文件路径为空")
		return
	}
	if _, err := os.Stat(item.FilePath); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			RespondError(c, http.StatusNotFound, "文件不存在")
			return
		}
		RespondError(c, http.StatusInternalServerError, "读取文件失败: "+err.Error())
		return
	}
	c.FileAttachment(item.FilePath, filepath.Base(item.FilePath))
}
