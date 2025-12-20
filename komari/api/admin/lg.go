package admin

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/komari-monitor/komari/api"
	"github.com/komari-monitor/komari/database/lg"
	"github.com/komari-monitor/komari/database/models"
	"github.com/komari-monitor/komari/utils"
)

// GET /api/admin/lg/authorization
func ListLgAuthorizations(c *gin.Context) {
	list, err := lg.ListAuthorizations(lg.AuthorizationFilter{})
	if err != nil {
		api.RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}
	api.RespondSuccess(c, list)
}

// POST /api/admin/lg/authorization
func CreateLgAuthorization(c *gin.Context) {
	var req models.LgAuthorization
	if err := c.ShouldBindJSON(&req); err != nil {
		api.RespondError(c, http.StatusBadRequest, "参数错误")
		return
	}
	req.Mode = strings.ToLower(req.Mode)
	if req.Mode == "code" && strings.TrimSpace(req.Code) == "" {
		req.Code = utils.GenerateRandomString(18)
	}
	if err := lg.CreateAuthorization(&req); err != nil {
		api.RespondError(c, http.StatusBadRequest, err.Error())
		return
	}
	api.RespondSuccess(c, req)
}

// POST /api/admin/lg/authorization/update
func UpdateLgAuthorization(c *gin.Context) {
	var req models.LgAuthorization
	if err := c.ShouldBindJSON(&req); err != nil {
		api.RespondError(c, http.StatusBadRequest, "参数错误")
		return
	}
	req.Mode = strings.ToLower(req.Mode)
	if req.Mode == "code" && strings.TrimSpace(req.Code) == "" {
		req.Code = utils.GenerateRandomString(18)
	}
	if err := lg.UpdateAuthorization(&req); err != nil {
		api.RespondError(c, http.StatusBadRequest, err.Error())
		return
	}
	api.RespondSuccess(c, req)
}

// POST /api/admin/lg/authorization/delete
func DeleteLgAuthorization(c *gin.Context) {
	var req struct {
		ID uint `json:"id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.ID == 0 {
		api.RespondError(c, http.StatusBadRequest, "参数错误")
		return
	}
	if err := lg.DeleteAuthorization(req.ID); err != nil {
		api.RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}
	api.RespondSuccess(c, nil)
}

// GET /api/admin/lg/tool-setting
func GetLgToolSettings(c *gin.Context) {
	list, err := lg.ListToolSettings()
	if err != nil {
		api.RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}
	api.RespondSuccess(c, list)
}

// POST /api/admin/lg/tool-setting
func UpdateLgToolSettings(c *gin.Context) {
	var req struct {
		Settings []struct {
			Tool            string `json:"tool"`
			CommandTemplate string `json:"command_template"`
			TimeoutSeconds  int    `json:"timeout_seconds"`
		} `json:"settings"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		api.RespondError(c, http.StatusBadRequest, "参数错误: "+err.Error())
		return
	}
	if len(req.Settings) == 0 {
		api.RespondSuccess(c, gin.H{"updated": 0})
		return
	}
	// 仅保留必要字段，忽略前端回传的 created_at/updated_at 等
	settings := make([]models.LgToolSetting, 0, len(req.Settings))
	for _, s := range req.Settings {
		settings = append(settings, models.LgToolSetting{
			Tool:            s.Tool,
			CommandTemplate: s.CommandTemplate,
			TimeoutSeconds:  s.TimeoutSeconds,
		})
	}
	if err := lg.UpsertToolSettings(settings); err != nil {
		api.RespondError(c, http.StatusBadRequest, err.Error())
		return
	}
	api.RespondSuccess(c, gin.H{"updated": len(settings)})
}
