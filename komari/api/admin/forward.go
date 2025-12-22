package admin

import (
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/komari-monitor/komari/api"
	dbforward "github.com/komari-monitor/komari/database/forward"
	"github.com/komari-monitor/komari/database/models"
	"github.com/komari-monitor/komari/forward"
)

type forwardRulePayload struct {
	IsEnabled   *bool  `json:"is_enabled"`
	Name        string `json:"name"`
	GroupName   string `json:"group_name"`
	SortOrder   *int   `json:"sort_order"`
	Tags        string `json:"tags"`
	Notes       string `json:"notes"`
	Type        string `json:"type"`
	Status      string `json:"status"`
	ConfigJSON  string `json:"config_json"`
	RealmConfig string `json:"realm_config"`
}

func ListForwards(c *gin.Context) {
	rules, err := dbforward.ListForwardRules()
	if err != nil {
		api.RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}
	api.RespondSuccess(c, rules)
}

func GetForward(c *gin.Context) {
	id, err := api.GetUintParam(c, "id")
	if err != nil {
		api.RespondError(c, http.StatusBadRequest, err.Error())
		return
	}
	rule, err := dbforward.GetForwardRule(id)
	if err != nil {
		api.RespondError(c, http.StatusNotFound, err.Error())
		return
	}
	api.RespondSuccess(c, rule)
}

func CreateForward(c *gin.Context) {
	var payload forwardRulePayload
	if err := c.ShouldBindJSON(&payload); err != nil {
		api.RespondError(c, http.StatusBadRequest, err.Error())
		return
	}
	configJSON := payload.ConfigJSON
	if configJSON != "" {
		configJSON = sanitizeConfigJSON(configJSON)
	}
	rule := models.ForwardRule{
		IsEnabled:   payload.IsEnabled != nil && *payload.IsEnabled,
		Name:        payload.Name,
		GroupName:   payload.GroupName,
		SortOrder:   valueOrDefaultInt(payload.SortOrder, 0),
		Tags:        payload.Tags,
		Notes:       payload.Notes,
		Type:        payload.Type,
		Status:      payload.Status,
		ConfigJSON:  configJSON,
		RealmConfig: payload.RealmConfig,
	}
	if rule.Status == "" {
		rule.Status = "stopped"
	}
	if err := dbforward.CreateForwardRule(&rule); err != nil {
		api.RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}
	api.RespondSuccess(c, rule)
}

func UpdateForward(c *gin.Context) {
	id, err := api.GetUintParam(c, "id")
	if err != nil {
		api.RespondError(c, http.StatusBadRequest, err.Error())
		return
	}
	var payload forwardRulePayload
	if err := c.ShouldBindJSON(&payload); err != nil {
		api.RespondError(c, http.StatusBadRequest, err.Error())
		return
	}
	var oldRule *models.ForwardRule
	oldRule, _ = dbforward.GetForwardRule(id)
	updates := map[string]interface{}{}
	if payload.IsEnabled != nil {
		updates["is_enabled"] = *payload.IsEnabled
	}
	if payload.Name != "" {
		updates["name"] = payload.Name
	}
	updates["group_name"] = payload.GroupName
	if payload.SortOrder != nil {
		updates["sort_order"] = *payload.SortOrder
	}
	updates["tags"] = payload.Tags
	updates["notes"] = payload.Notes
	if payload.Type != "" {
		updates["type"] = payload.Type
	}
	if payload.Status != "" {
		updates["status"] = payload.Status
	}
	if payload.ConfigJSON != "" {
		updates["config_json"] = sanitizeConfigJSON(payload.ConfigJSON)
	}
	if payload.RealmConfig != "" {
		updates["realm_config"] = payload.RealmConfig
	}
	if len(updates) > 0 && oldRule != nil && oldRule.Status == "running" && (updates["config_json"] != nil || updates["realm_config"] != nil) {
		newRule := *oldRule
		if v, ok := updates["config_json"].(string); ok {
			newRule.ConfigJSON = v
		}
		if v, ok := updates["realm_config"].(string); ok {
			newRule.RealmConfig = v
		}
		if err := forward.ApplyHotUpdate(oldRule, &newRule); err != nil {
			api.RespondError(c, http.StatusInternalServerError, err.Error())
			return
		}
	}
	if err := dbforward.UpdateForwardRule(id, updates); err != nil {
		api.RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}
	rule, _ := dbforward.GetForwardRule(id)
	api.RespondSuccess(c, rule)
}

func DeleteForward(c *gin.Context) {
	id, err := api.GetUintParam(c, "id")
	if err != nil {
		api.RespondError(c, http.StatusBadRequest, err.Error())
		return
	}
	if err := dbforward.DeleteForwardRule(id); err != nil {
		api.RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}
	api.RespondSuccess(c, gin.H{"deleted": true})
}

func EnableForward(c *gin.Context) {
	id, err := api.GetUintParam(c, "id")
	if err != nil {
		api.RespondError(c, http.StatusBadRequest, err.Error())
		return
	}
	updates := map[string]interface{}{"is_enabled": true}
	if err := dbforward.UpdateForwardRule(id, updates); err != nil {
		api.RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}
	rule, _ := dbforward.GetForwardRule(id)
	api.RespondSuccess(c, rule)
}

func DisableForward(c *gin.Context) {
	id, err := api.GetUintParam(c, "id")
	if err != nil {
		api.RespondError(c, http.StatusBadRequest, err.Error())
		return
	}
	updates := map[string]interface{}{"is_enabled": false}
	if err := dbforward.UpdateForwardRule(id, updates); err != nil {
		api.RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}
	rule, _ := dbforward.GetForwardRule(id)
	api.RespondSuccess(c, rule)
}

func GetForwardSystemSettings(c *gin.Context) {
	settings, err := dbforward.GetSystemSettings()
	if err != nil {
		api.RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}
	api.RespondSuccess(c, settings)
}

func UpdateForwardSystemSettings(c *gin.Context) {
	var payload models.ForwardSystemSettings
	if err := c.ShouldBindJSON(&payload); err != nil {
		api.RespondError(c, http.StatusBadRequest, err.Error())
		return
	}
	payload.ID = 1
	if err := dbforward.UpdateSystemSettings(&payload); err != nil {
		api.RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}
	api.RespondSuccess(c, payload)
}

func GetRealmTemplate(c *gin.Context) {
	tmpl, err := dbforward.GetRealmConfigTemplate()
	if err != nil {
		api.RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}
	api.RespondSuccess(c, tmpl)
}

func UpdateRealmTemplate(c *gin.Context) {
	var payload models.RealmConfigTemplate
	if err := c.ShouldBindJSON(&payload); err != nil {
		api.RespondError(c, http.StatusBadRequest, err.Error())
		return
	}
	if err := dbforward.UpdateRealmConfigTemplate(&payload); err != nil {
		api.RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}
	api.RespondSuccess(c, payload)
}

func valueOrDefaultInt(ptr *int, def int) int {
	if ptr == nil {
		return def
	}
	return *ptr
}

func sanitizeConfigJSON(raw string) string {
	var cfg forward.RuleConfig
	if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
		return raw
	}
	cfg.EntryRealmConfig = forward.SanitizeManualRealmConfig(cfg.EntryRealmConfig)
	for i := range cfg.Relays {
		cfg.Relays[i].RealmConfig = forward.SanitizeManualRealmConfig(cfg.Relays[i].RealmConfig)
	}
	for i := range cfg.Hops {
		cfg.Hops[i].RealmConfig = forward.SanitizeManualRealmConfig(cfg.Hops[i].RealmConfig)
		for j := range cfg.Hops[i].Relays {
			cfg.Hops[i].Relays[j].RealmConfig = forward.SanitizeManualRealmConfig(cfg.Hops[i].Relays[j].RealmConfig)
		}
	}
	b, err := json.Marshal(cfg)
	if err != nil {
		return raw
	}
	return string(b)
}
