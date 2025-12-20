package api

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/komari-monitor/komari/database/installscripts"
	"gorm.io/gorm"
)

func GetInstallScriptSh(c *gin.Context) {
	getInstallScript(c, "install.sh")
}

func GetInstallScriptPs1(c *gin.Context) {
	getInstallScript(c, "install.ps1")
}

func getInstallScript(c *gin.Context, name string) {
	s, err := installscripts.GetByName(name)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			RespondError(c, http.StatusNotFound, "脚本不存在")
			return
		}
		RespondError(c, http.StatusInternalServerError, "读取脚本失败: "+err.Error())
		return
	}
	c.Header("Content-Type", "text/plain; charset=utf-8")
	c.Header("Cache-Control", "no-store")
	c.String(http.StatusOK, s.Body)
}

