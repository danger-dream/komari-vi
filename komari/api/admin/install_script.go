package admin

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/komari-monitor/komari/api"
	"github.com/komari-monitor/komari/database/auditlog"
	"github.com/komari-monitor/komari/database/installscripts"
)

func ListInstallScripts(c *gin.Context) {
	list, err := installscripts.List()
	if err != nil {
		api.RespondError(c, http.StatusInternalServerError, "获取脚本失败: "+err.Error())
		return
	}
	api.RespondSuccess(c, list)
}

func UpdateInstallScript(c *gin.Context) {
	name := strings.TrimSpace(c.Param("name"))
	if name == "" {
		api.RespondError(c, http.StatusBadRequest, "缺少脚本名称")
		return
	}
	if name != "install.sh" && name != "install.ps1" {
		api.RespondError(c, http.StatusBadRequest, "仅允许更新 install.sh / install.ps1")
		return
	}
	var req struct {
		Body string `json:"body" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		api.RespondError(c, http.StatusBadRequest, "请求格式错误: "+err.Error())
		return
	}
	_, err := installscripts.Upsert(name, req.Body)
	if err != nil {
		api.RespondError(c, http.StatusInternalServerError, "保存失败: "+err.Error())
		return
	}
	userUUID, _ := c.Get("uuid")
	auditlog.Log(c.ClientIP(), userUUID.(string), "update install script:"+name, "info")
	api.RespondSuccess(c, gin.H{"updated": true})
}
