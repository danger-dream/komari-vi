package admin

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/komari-monitor/komari/api"
	dbforward "github.com/komari-monitor/komari/database/forward"
	"github.com/komari-monitor/komari/database/models"
)

// GetForwardAlertConfig 获取单规则告警配置
func GetForwardAlertConfig(c *gin.Context) {
	id, err := api.GetUintParam(c, "id")
	if err != nil {
		api.RespondError(c, http.StatusBadRequest, err.Error())
		return
	}
	cfg, err := dbforward.GetAlertConfig(id)
	if err != nil {
		api.RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}
	api.RespondSuccess(c, cfg)
}

// UpdateForwardAlertConfig 更新单规则告警配置
func UpdateForwardAlertConfig(c *gin.Context) {
	id, err := api.GetUintParam(c, "id")
	if err != nil {
		api.RespondError(c, http.StatusBadRequest, err.Error())
		return
	}
	var payload models.ForwardAlertConfig
	if err := c.ShouldBindJSON(&payload); err != nil {
		api.RespondError(c, http.StatusBadRequest, err.Error())
		return
	}
	if err := dbforward.UpdateAlertConfig(id, &payload); err != nil {
		api.RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}
	cfg, _ := dbforward.GetAlertConfig(id)
	api.RespondSuccess(c, cfg)
}
