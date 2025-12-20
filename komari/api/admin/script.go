package admin

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/komari-monitor/komari/api"
	"github.com/komari-monitor/komari/database/models"
	scriptdb "github.com/komari-monitor/komari/database/script"
	"github.com/komari-monitor/komari/ws"
)

type scriptPayload struct {
	ID               uint                          `json:"id"`
	FolderID         *uint                         `json:"folder_id"`
	Order            int                           `json:"order"`
	Name             string                        `json:"name" binding:"required"`
	Enabled          bool                          `json:"enabled"`
	Clients          []string                      `json:"clients"`
	ClientStatus     models.ScriptClientStatusList `json:"client_status"`
	ScriptBody       string                        `json:"script_body"`
	TimeoutSec       int                           `json:"timeout_sec"`
	TriggerKind      string                        `json:"trigger_kind"`
	CronExpr         string                        `json:"cron_expr"`
	TriggerName      string                        `json:"trigger_name"`
	MessageType      string                        `json:"message_type"`
	DependsOnScripts []uint                        `json:"depends_on_scripts"`
	DependsOnFolders []uint                        `json:"depends_on_folders"`
}

func toModelScript(req *scriptPayload) *models.Script {
	if req == nil {
		return nil
	}
	return &models.Script{
		ID:               req.ID,
		FolderID:         req.FolderID,
		Order:            req.Order,
		Name:             req.Name,
		Enabled:          req.Enabled,
		Clients:          models.StringArray(req.Clients),
		ClientStatus:     req.ClientStatus,
		ScriptBody:       req.ScriptBody,
		TimeoutSec:       req.TimeoutSec,
		TriggerKind:      req.TriggerKind,
		CronExpr:         req.CronExpr,
		TriggerName:      req.TriggerName,
		MessageType:      req.MessageType,
		DependsOnScripts: models.UIntArray(req.DependsOnScripts),
		DependsOnFolders: models.UIntArray(req.DependsOnFolders),
	}
}

func GetScriptStructure(c *gin.Context) {
	folders, err := scriptdb.GetAllFolders()
	if err != nil {
		api.RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}
	scripts, err := scriptdb.GetAllScripts()
	if err != nil {
		api.RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}
	api.RespondSuccess(c, gin.H{
		"folders": folders,
		"scripts": scripts,
	})
}

func AddScriptFolder(c *gin.Context) {
	var req models.ScriptFolder
	if err := c.ShouldBindJSON(&req); err != nil {
		api.RespondError(c, http.StatusBadRequest, err.Error())
		return
	}
	if err := scriptdb.AddFolder(&req); err != nil {
		api.RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}
	api.RespondSuccess(c, req)
}

func EditScriptFolder(c *gin.Context) {
	var req models.ScriptFolder
	if err := c.ShouldBindJSON(&req); err != nil {
		api.RespondError(c, http.StatusBadRequest, err.Error())
		return
	}
	if req.ID == 0 {
		api.RespondError(c, http.StatusBadRequest, "id required")
		return
	}
	if err := scriptdb.UpdateFolder(&req); err != nil {
		api.RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}
	api.RespondSuccess(c, nil)
}

func DeleteScriptFolder(c *gin.Context) {
	var req struct {
		ID uint `json:"id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		api.RespondError(c, http.StatusBadRequest, err.Error())
		return
	}
	if err := scriptdb.DeleteFolder(req.ID); err != nil {
		api.RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}
	api.RespondSuccess(c, nil)
}

func GetScripts(c *gin.Context) {
	list, err := scriptdb.GetAllScripts()
	if err != nil {
		api.RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}
	api.RespondSuccess(c, list)
}

func AddScript(c *gin.Context) {
	var req scriptPayload
	if err := c.ShouldBindJSON(&req); err != nil {
		api.RespondError(c, http.StatusBadRequest, err.Error())
		return
	}
	if req.MessageType == "" {
		req.MessageType = "script"
	}
	model := toModelScript(&req)
	if err := scriptdb.CreateScript(model); err != nil {
		api.RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}
	scriptdb.ReloadScriptSchedule()
	api.RespondSuccess(c, gin.H{"id": model.ID})
}

func EditScript(c *gin.Context) {
	var req struct {
		Scripts []*scriptPayload `json:"scripts" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		api.RespondError(c, http.StatusBadRequest, err.Error())
		return
	}
	var modelsToUpdate []*models.Script
	for _, item := range req.Scripts {
		modelsToUpdate = append(modelsToUpdate, toModelScript(item))
	}
	if err := scriptdb.UpdateScripts(modelsToUpdate); err != nil {
		api.RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}
	scriptdb.ReloadScriptSchedule()
	api.RespondSuccess(c, nil)
}

func DeleteScript(c *gin.Context) {
	var req struct {
		ID uint `json:"id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		api.RespondError(c, http.StatusBadRequest, err.Error())
		return
	}
	if err := scriptdb.DeleteScript(req.ID); err != nil {
		api.RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}
	scriptdb.ReloadScriptSchedule()
	api.RespondSuccess(c, nil)
}

func ExecuteScript(c *gin.Context) {
	var req struct {
		ID      uint                   `json:"id" binding:"required"`
		Clients []string               `json:"clients"`
		Params  map[string]interface{} `json:"params"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		api.RespondError(c, http.StatusBadRequest, err.Error())
		return
	}
	s, err := scriptdb.GetScriptByID(req.ID)
	if err != nil {
		api.RespondError(c, http.StatusBadRequest, err.Error())
		return
	}
	targets := req.Clients
	if len(targets) == 0 {
		targets = []string(s.Clients)
	}
	if len(targets) == 0 {
		api.RespondError(c, http.StatusBadRequest, "no clients specified")
		return
	}
	execID, err := scriptdb.DispatchScript(s, targets, "manual", req.Params)
	if err != nil {
		api.RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}
	api.RespondSuccess(c, gin.H{"exec_id": execID})
}

func StopScript(c *gin.Context) {
	var req struct {
		ScriptID uint     `json:"script_id" binding:"required"`
		ExecID   string   `json:"exec_id" binding:"required"`
		Clients  []string `json:"clients"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		api.RespondError(c, http.StatusBadRequest, err.Error())
		return
	}
	s, err := scriptdb.GetScriptByID(req.ScriptID)
	if err != nil {
		api.RespondError(c, http.StatusBadRequest, err.Error())
		return
	}
	targets := req.Clients
	if len(targets) == 0 {
		targets = []string(s.Clients)
	}
	if len(targets) == 0 {
		api.RespondError(c, http.StatusBadRequest, "no clients specified")
		return
	}
	payload := map[string]interface{}{
		"message":   "script_stop",
		"script_id": req.ScriptID,
		"exec_id":   req.ExecID,
	}
	online := ws.GetConnectedClients()
	sent := 0
	for _, cid := range targets {
		if conn, ok := online[cid]; ok && conn != nil {
			if err := conn.WriteJSON(payload); err == nil {
				sent++
			}
		} else {
			ws.AddPendingStop(cid, ws.PendingStop{ScriptID: req.ScriptID, ExecID: req.ExecID})
		}
		_ = scriptdb.UpdateClientExecutionStatus(req.ScriptID, cid, req.ExecID, "sent", "stopping", "stop requested")
	}
	api.RespondSuccess(c, gin.H{"sent": sent})
}

func ForceStopScript(c *gin.Context) {
	var req struct {
		ScriptID uint     `json:"script_id" binding:"required"`
		ExecID   string   `json:"exec_id" binding:"required"`
		Clients  []string `json:"clients"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		api.RespondError(c, http.StatusBadRequest, err.Error())
		return
	}
	s, err := scriptdb.GetScriptByID(req.ScriptID)
	if err != nil {
		api.RespondError(c, http.StatusBadRequest, err.Error())
		return
	}
	targets := req.Clients
	if len(targets) == 0 {
		targets = []string(s.Clients)
	}
	if len(targets) == 0 {
		api.RespondError(c, http.StatusBadRequest, "no clients specified")
		return
	}
	// 立即标记状态并推送停止（在线）；离线的加入待发送列表
	online := ws.GetConnectedClients()
	sent := 0
	for _, cid := range targets {
		if conn, ok := online[cid]; ok && conn != nil {
			if err := conn.WriteJSON(map[string]interface{}{
				"message":   "script_stop",
				"script_id": req.ScriptID,
				"exec_id":   req.ExecID,
			}); err == nil {
				sent++
			}
		} else {
			ws.AddPendingStop(cid, ws.PendingStop{ScriptID: req.ScriptID, ExecID: req.ExecID})
		}
		_ = scriptdb.UpdateClientExecutionStatus(req.ScriptID, cid, req.ExecID, "sent", "waiting_stop", "force stop queued")
	}
	_ = scriptdb.ForceFinishHistory(req.ScriptID, req.ExecID, targets, "forced stop by admin")
	api.RespondSuccess(c, gin.H{"sent": sent})
}

func GetScriptHistory(c *gin.Context) {
	scriptIDStr := c.Query("script_id")
	if scriptIDStr == "" {
		api.RespondError(c, http.StatusBadRequest, "script_id is required")
		return
	}
	sid, _ := strconv.Atoi(scriptIDStr)
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	history, err := scriptdb.ListHistory(uint(sid), limit, offset)
	if err != nil {
		api.RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}
	api.RespondSuccess(c, history)
}

func GetScriptVariables(c *gin.Context) {
	scope := c.Query("scope")
	if scope == "" {
		api.RespondError(c, http.StatusBadRequest, "scope is required")
		return
	}
	var scriptID *uint
	if v := c.Query("script_id"); v != "" {
		if val, err := strconv.Atoi(v); err == nil {
			tmp := uint(val)
			scriptID = &tmp
		}
	}
	var clientUUID *string
	if v := c.Query("client_uuid"); v != "" {
		clientUUID = &v
	}
	vars, err := scriptdb.GetVariables(scope, scriptID, clientUUID)
	if err != nil {
		api.RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}
	api.RespondSuccess(c, vars)
}

func SetScriptVariable(c *gin.Context) {
	var req struct {
		Scope      string  `json:"scope" binding:"required"`
		ScriptID   *uint   `json:"script_id"`
		ClientUUID *string `json:"client_uuid"`
		Key        string  `json:"key" binding:"required"`
		Value      string  `json:"value" binding:"required"`
		ValueType  string  `json:"value_type" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		api.RespondError(c, http.StatusBadRequest, err.Error())
		return
	}
	if err := scriptdb.SetVariable(req.Scope, req.ScriptID, req.ClientUUID, req.Key, req.Value, req.ValueType, "admin"); err != nil {
		api.RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}
	api.RespondSuccess(c, nil)
}

func DeleteScriptVariable(c *gin.Context) {
	var req struct {
		ID uint `json:"id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		api.RespondError(c, http.StatusBadRequest, err.Error())
		return
	}
	if err := scriptdb.DeleteVariable(req.ID); err != nil {
		api.RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}
	api.RespondSuccess(c, nil)
}
