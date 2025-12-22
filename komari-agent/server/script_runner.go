package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/komari-monitor/komari-agent/forward"
	"github.com/komari-monitor/komari-agent/script"
	"github.com/komari-monitor/komari-agent/ws"
)

type wsMessage struct {
	Message      string `json:"message"`
	TerminalId   string `json:"request_id,omitempty"`
	LgRequest    string `json:"lg_request_id,omitempty"`
	ExecCommand  string `json:"command,omitempty"`
	ExecTaskID   string `json:"task_id,omitempty"`
	PingTaskID   uint   `json:"ping_task_id,omitempty"`
	PingType     string `json:"ping_type,omitempty"`
	PingTarget   string `json:"ping_target,omitempty"`
	SPPingTaskID uint   `json:"sp_ping_task_id,omitempty"`
	SPPingType   string `json:"sp_ping_type,omitempty"`
	SPPingTarget string `json:"sp_ping_target,omitempty"`
	SPPings      int    `json:"pings,omitempty"`
	SPTimeoutMS  int    `json:"timeout_ms,omitempty"`
	SPPayload    int    `json:"payload_size,omitempty"`
	ScriptID     uint   `json:"script_id,omitempty"`
	ScriptExecID string `json:"exec_id,omitempty"`
	ScriptName   string `json:"name,omitempty"`
	ScriptBody   string `json:"script_body,omitempty"`
	TriggerKind  string `json:"trigger_kind,omitempty"`
	TriggerName  string `json:"trigger_name,omitempty"`
	TimeoutSec   int    `json:"timeout_sec,omitempty"`
	Dependencies []struct {
		ID         uint   `json:"id"`
		Name       string `json:"name"`
		FolderID   *uint  `json:"folder_id"`
		ScriptBody string `json:"script_body"`
	} `json:"dependencies,omitempty"`
	Params json.RawMessage      `json:"params,omitempty"`
	Task   forward.TaskEnvelope `json:"task,omitempty"`
}

var (
	scriptCancelMap = make(map[string]context.CancelFunc)
	scriptCancelMu  sync.Mutex
)

func RunScriptFromMessage(conn *ws.SafeConn, msg *wsMessage) {
	params := make(map[string]interface{})
	if len(msg.Params) > 0 {
		_ = json.Unmarshal(msg.Params, &params)
	}
	ctxRun, cancel := context.WithCancel(context.Background())
	if msg.TimeoutSec > 0 {
		ctxRun, cancel = context.WithTimeout(context.Background(), time.Duration(msg.TimeoutSec)*time.Second)
	}
	defer cancel()
	scriptCancelMu.Lock()
	scriptCancelMap[msg.ScriptExecID] = cancel
	scriptCancelMu.Unlock()
	ctx := script.Context{
		ScriptID:    msg.ScriptID,
		ExecID:      msg.ScriptExecID,
		Name:        msg.ScriptName,
		TriggerKind: msg.TriggerKind,
		TriggerName: msg.TriggerName,
		TimeoutSec:  msg.TimeoutSec,
		Endpoint:    flags.Endpoint,
		Token:       flags.Token,
		CFAccessID:  flags.CFAccessClientID,
		CFAccessKey: flags.CFAccessClientSecret,
		Params:      params,
		DisableExec: flags.DisableWebSsh,
	}
	deps := make([]script.DependencySnippet, 0, len(msg.Dependencies))
	for _, dep := range msg.Dependencies {
		deps = append(deps, script.DependencySnippet{
			ID:         dep.ID,
			Name:       dep.Name,
			FolderID:   dep.FolderID,
			ScriptBody: dep.ScriptBody,
		})
	}
	_ = reportScriptStart(ctx)
	engine, err := script.NewEngine(ctx, msg.ScriptBody, deps, func(level, message string) {
		sendScriptLog(conn, ctx.ScriptID, ctx.ExecID, level, message)
	})
	if err != nil {
		_ = reportScriptResult(ctx, "failed", "", err.Error())
		scriptCancelMu.Lock()
		delete(scriptCancelMap, msg.ScriptExecID)
		scriptCancelMu.Unlock()
		return
	}
	defer func() {
		scriptCancelMu.Lock()
		delete(scriptCancelMap, msg.ScriptExecID)
		scriptCancelMu.Unlock()
	}()
	result, runErr := engine.Run(ctxRun)
	var status string
	if errors.Is(runErr, context.DeadlineExceeded) {
		status = "timeout"
	} else if errors.Is(runErr, context.Canceled) {
		status = "failed"
		runErr = fmt.Errorf("stopped by request")
	}
	if status == "" {
		if runErr != nil {
			status = "failed"
		} else {
			status = "success"
		}
	}
	outStr := ""
	if result != nil {
		if b, err := json.Marshal(result); err == nil {
			outStr = string(b)
		} else {
			outStr = fmt.Sprint(result)
		}
	}
	errMsg := ""
	if runErr != nil {
		errMsg = runErr.Error()
	}
	_ = reportScriptResult(ctx, status, outStr, errMsg)
}

func sendScriptLog(conn *ws.SafeConn, scriptID uint, execID, level, message string) {
	payload := map[string]interface{}{
		"type":      "script_log",
		"script_id": scriptID,
		"exec_id":   execID,
		"level":     level,
		"message":   message,
		"time":      time.Now().Format(time.RFC3339),
	}
	if err := conn.WriteJSON(payload); err != nil {
		log.Printf("failed to send script log: %v", err)
	}
}

func reportScriptStart(ctx script.Context) error {
	body := map[string]interface{}{
		"script_id":    ctx.ScriptID,
		"exec_id":      ctx.ExecID,
		"trigger_kind": ctx.TriggerKind,
		"trigger_name": ctx.TriggerName,
		"started_at":   time.Now().Format(time.RFC3339),
	}
	return postScriptPayload("/api/clients/script/history/start", body)
}

func reportScriptResult(ctx script.Context, status, output, errMsg string) error {
	body := map[string]interface{}{
		"script_id":   ctx.ScriptID,
		"exec_id":     ctx.ExecID,
		"status":      status,
		"output":      output,
		"error":       errMsg,
		"finished_at": time.Now().Format(time.RFC3339),
	}
	return postScriptPayload("/api/clients/script/history/result", body)
}

func postScriptPayload(path string, payload map[string]interface{}) error {
	data, _ := json.Marshal(payload)
	url := strings.TrimSuffix(flags.Endpoint, "/") + path + "?token=" + flags.Token
	req, err := http.NewRequest("POST", url, bytes.NewBuffer(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if flags.CFAccessClientID != "" && flags.CFAccessClientSecret != "" {
		req.Header.Set("CF-Access-Client-Id", flags.CFAccessClientID)
		req.Header.Set("CF-Access-Client-Secret", flags.CFAccessClientSecret)
	}
	resp, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		buf, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("request failed: %s %s", resp.Status, string(buf))
	}
	return nil
}
