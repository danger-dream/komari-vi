package admin

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/komari-monitor/komari/api"
	dbforward "github.com/komari-monitor/komari/database/forward"
	"github.com/komari-monitor/komari/database/models"
	"github.com/komari-monitor/komari/forward"
)

type forwardPreviewReq struct {
	Type       string `json:"type" binding:"required"`
	ConfigJSON string `json:"config_json" binding:"required"`
}

// PreviewForwardRealmConfig 预览规则各节点的 Realm 配置
func PreviewForwardRealmConfig(c *gin.Context) {
	var req forwardPreviewReq
	if err := c.ShouldBindJSON(&req); err != nil {
		api.RespondError(c, http.StatusBadRequest, err.Error())
		return
	}
	template, err := dbforward.GetRealmConfigTemplate()
	if err != nil {
		api.RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}
	rule := models.ForwardRule{
		Type:       req.Type,
		ConfigJSON: req.ConfigJSON,
	}
	cfgs, err := forward.GenerateRealmConfigs(rule, template.TemplateToml, resolveNodeIP)
	if err != nil {
		api.RespondError(c, http.StatusBadRequest, err.Error())
		return
	}
	api.RespondSuccess(c, gin.H{"node_configs": cfgs})
}
