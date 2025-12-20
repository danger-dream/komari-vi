package client

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/komari-monitor/komari/api"
	"github.com/komari-monitor/komari/database/clients"
	"github.com/komari-monitor/komari/database/models"
	scriptdb "github.com/komari-monitor/komari/database/script"
	"gorm.io/gorm"
)

func ScriptHistoryStart(c *gin.Context) {
	token := c.Query("token")
	clientUUID, _ := clients.GetClientUUIDByToken(token)
	if clientUUID == "" {
		api.RespondError(c, http.StatusUnauthorized, "invalid token")
		return
	}
	var req struct {
		ScriptID    uint   `json:"script_id" binding:"required"`
		ExecID      string `json:"exec_id" binding:"required"`
		TriggerKind string `json:"trigger_kind"`
		TriggerName string `json:"trigger_name"`
		StartedAt   string `json:"started_at"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		api.RespondError(c, http.StatusBadRequest, err.Error())
		return
	}
	startAt := time.Now()
	if req.StartedAt != "" {
		if t, err := time.Parse(time.RFC3339, req.StartedAt); err == nil {
			startAt = t
		}
	}
	if err := scriptdb.CreateHistoryStart(req.ScriptID, req.ExecID, clientUUID, req.TriggerKind, req.TriggerName, startAt); err != nil {
		api.RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}
	_ = scriptdb.UpdateClientExecutionStatus(req.ScriptID, clientUUID, req.ExecID, "sent", "running", "")
	api.RespondSuccess(c, nil)
}

func ScriptHistoryResult(c *gin.Context) {
	token := c.Query("token")
	clientUUID, _ := clients.GetClientUUIDByToken(token)
	if clientUUID == "" {
		api.RespondError(c, http.StatusUnauthorized, "invalid token")
		return
	}
	var req struct {
		ScriptID   uint   `json:"script_id" binding:"required"`
		ExecID     string `json:"exec_id" binding:"required"`
		Status     string `json:"status" binding:"required"`
		Output     string `json:"output"`
		ErrorLog   string `json:"error"`
		FinishedAt string `json:"finished_at"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		api.RespondError(c, http.StatusBadRequest, err.Error())
		return
	}
	finAt := time.Now()
	if req.FinishedAt != "" {
		if t, err := time.Parse(time.RFC3339, req.FinishedAt); err == nil {
			finAt = t
		}
	}
	// 写入简单输出行，方便历史回放
	if req.Output != "" {
		_ = scriptdb.AppendHistoryOutput(req.ScriptID, req.ExecID, clientUUID, models.ScriptLogEntry{
			Time:    models.FromTime(finAt),
			Type:    "info",
			Content: req.Output,
		})
	}
	if err := scriptdb.FinishHistory(req.ScriptID, req.ExecID, clientUUID, req.Status, req.Output, req.ErrorLog, finAt); err != nil {
		api.RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}
	_ = scriptdb.UpdateClientExecutionStatus(req.ScriptID, clientUUID, req.ExecID, "sent", req.Status, req.ErrorLog)
	api.RespondSuccess(c, nil)
}

func ScriptStorageGet(c *gin.Context) {
	token := c.Query("token")
	clientUUID, _ := clients.GetClientUUIDByToken(token)
	if clientUUID == "" {
		api.RespondError(c, http.StatusUnauthorized, "invalid token")
		return
	}
	var req struct {
		Scope    string `json:"scope" binding:"required"`
		ScriptID *uint  `json:"script_id"`
		Key      string `json:"key" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		api.RespondError(c, http.StatusBadRequest, err.Error())
		return
	}
	var scriptID *uint = req.ScriptID
	var clientPtr *string
	if req.Scope == "node" {
		clientPtr = &clientUUID
	}
	record, err := scriptdb.GetVariable(req.Scope, scriptID, clientPtr, req.Key)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			api.RespondSuccess(c, gin.H{"found": false})
			return
		}
		api.RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}
	api.RespondSuccess(c, gin.H{
		"found":      true,
		"value":      record.Value,
		"value_type": record.ValueType,
	})
}

func ScriptStorageSet(c *gin.Context) {
	token := c.Query("token")
	clientUUID, _ := clients.GetClientUUIDByToken(token)
	if clientUUID == "" {
		api.RespondError(c, http.StatusUnauthorized, "invalid token")
		return
	}
	var req struct {
		Scope     string `json:"scope" binding:"required"`
		ScriptID  *uint  `json:"script_id"`
		Key       string `json:"key" binding:"required"`
		Value     string `json:"value" binding:"required"`
		ValueType string `json:"value_type" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		api.RespondError(c, http.StatusBadRequest, err.Error())
		return
	}
	var scriptID *uint = req.ScriptID
	var clientPtr *string
	if req.Scope == "node" {
		clientPtr = &clientUUID
	}
	if err := scriptdb.SetVariable(req.Scope, scriptID, clientPtr, req.Key, req.Value, req.ValueType, clientUUID); err != nil {
		api.RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}
	api.RespondSuccess(c, nil)
}

// ScriptLogIncoming 接收 agent 侧推送的实时日志（通过 ws）
func ScriptLogIncoming(clientUUID string, payload json.RawMessage) {
	// 占位：具体逻辑在 websocket 入口处理，这里预留统一入口方便扩展
	_ = clientUUID
	_ = payload
}
