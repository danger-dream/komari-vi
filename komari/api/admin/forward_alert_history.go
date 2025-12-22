package admin

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/komari-monitor/komari/api"
	dbforward "github.com/komari-monitor/komari/database/forward"
)

// GetForwardAlertHistory 获取告警历史
func GetForwardAlertHistory(c *gin.Context) {
	id, err := api.GetUintParam(c, "id")
	if err != nil {
		api.RespondError(c, http.StatusBadRequest, err.Error())
		return
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	if limit <= 0 {
		limit = 50
	}
	history, err := dbforward.ListAlertHistory(id, limit)
	if err != nil {
		api.RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}
	api.RespondSuccess(c, history)
}

// AcknowledgeForwardAlert 确认告警
func AcknowledgeForwardAlert(c *gin.Context) {
	id, err := api.GetUintParam(c, "id")
	if err != nil {
		api.RespondError(c, http.StatusBadRequest, err.Error())
		return
	}
	alertID, err := api.GetUintParam(c, "alertId")
	if err != nil {
		api.RespondError(c, http.StatusBadRequest, err.Error())
		return
	}
	userID := ""
	if v, ok := c.Get("uuid"); ok {
		if s, ok := v.(string); ok {
			userID = s
		}
	}
	if err := dbforward.AcknowledgeAlert(id, alertID, userID); err != nil {
		api.RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}
	api.RespondSuccess(c, gin.H{"acknowledged": true})
}
