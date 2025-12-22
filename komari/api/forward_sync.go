package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/komari-monitor/komari/forward"
)

// ForwardConfigSync 接收 Agent 上报的配置变更
func ForwardConfigSync(c *gin.Context) {
	id, err := GetUintParam(c, "id")
	if err != nil {
		RespondError(c, http.StatusBadRequest, err.Error())
		return
	}
	var payload struct {
		NodeID            string                 `json:"node_id"`
		RealmConfig       string                 `json:"realm_config"`
		ConfigJSONUpdates map[string]interface{} `json:"config_json_updates"`
		Reason            string                 `json:"reason"`
	}
	if err := c.ShouldBindJSON(&payload); err != nil {
		RespondError(c, http.StatusBadRequest, err.Error())
		return
	}

	if err := forward.ApplyConfigSync(id, payload.NodeID, payload.RealmConfig, payload.ConfigJSONUpdates, payload.Reason); err != nil {
		RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}

	RespondSuccess(c, gin.H{"synced": true})
}
