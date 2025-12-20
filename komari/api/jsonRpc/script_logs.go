package jsonRpc

import (
	"errors"
	"fmt"
	"sync"

	"github.com/komari-monitor/komari/utils/rpc"
	"github.com/komari-monitor/komari/ws"
)

type ScriptLogEvent struct {
	ScriptID   uint   `json:"script_id"`
	ExecID     string `json:"exec_id"`
	Level      string `json:"level"`
	Message    string `json:"message"`
	Time       string `json:"time"`
	ClientUUID string `json:"client_uuid,omitempty"`
}

var (
	scriptLogSubs   = make(map[string]map[*ws.SafeConn]struct{})
	scriptLogSubsMu sync.RWMutex
)

func subKey(scriptID uint, execID string) string {
	return fmt.Sprintf("%d:%s", scriptID, execID)
}

func clearScriptLogConn(conn *ws.SafeConn) {
	scriptLogSubsMu.Lock()
	defer scriptLogSubsMu.Unlock()
	for key, conns := range scriptLogSubs {
		if _, ok := conns[conn]; ok {
			delete(conns, conn)
		}
		if len(conns) == 0 {
			delete(scriptLogSubs, key)
		}
	}
}

func handleScriptLogRPC(conn *ws.SafeConn, req *rpc.JsonRpcRequest, permissionGroup string) bool {
	if req == nil {
		return false
	}
	if permissionGroup != "admin" {
		if req.HasID() {
			conn.WriteJSON(rpc.ErrorResponse(req.ID, rpc.Unavailable, "Unauthorized", nil))
		}
		return true
	}
	switch req.Method {
	case "script_logs.subscribe", "admin:script_logs.subscribe":
		scriptID, execID, err := parseScriptLogParams(req.Params)
		if err != nil {
			conn.WriteJSON(rpc.ErrorResponse(req.ID, rpc.InvalidParams, err.Error(), nil))
			return true
		}
		scriptLogSubsMu.Lock()
		key := subKey(scriptID, execID)
		if _, ok := scriptLogSubs[key]; !ok {
			scriptLogSubs[key] = make(map[*ws.SafeConn]struct{})
		}
		scriptLogSubs[key][conn] = struct{}{}
		scriptLogSubsMu.Unlock()
		conn.WriteJSON(rpc.SuccessResponse(req.ID, "ok"))
		return true
	case "script_logs.unsubscribe", "admin:script_logs.unsubscribe":
		scriptID, execID, err := parseScriptLogParams(req.Params)
		if err != nil {
			conn.WriteJSON(rpc.ErrorResponse(req.ID, rpc.InvalidParams, err.Error(), nil))
			return true
		}
		scriptLogSubsMu.Lock()
		key := subKey(scriptID, execID)
		if conns, ok := scriptLogSubs[key]; ok {
			delete(conns, conn)
			if len(conns) == 0 {
				delete(scriptLogSubs, key)
			}
		}
		scriptLogSubsMu.Unlock()
		conn.WriteJSON(rpc.SuccessResponse(req.ID, "ok"))
		return true
	default:
		return false
	}
}

func parseScriptLogParams(params any) (uint, string, error) {
	m, ok := params.(map[string]any)
	if !ok {
		return 0, "", errors.New("invalid params")
	}
	rawID, ok := m["script_id"]
	if !ok {
		return 0, "", errors.New("script_id required")
	}
	var scriptID uint
	switch v := rawID.(type) {
	case float64:
		scriptID = uint(v)
	case int:
		scriptID = uint(v)
	case uint:
		scriptID = v
	default:
		return 0, "", errors.New("invalid script_id")
	}
	execID := ""
	if v, ok := m["exec_id"]; ok && v != nil {
		execID = fmt.Sprint(v)
	}
	return scriptID, execID, nil
}

func PublishScriptLog(evt ScriptLogEvent) {
	key := subKey(evt.ScriptID, evt.ExecID)
	notification := rpc.NewNotification("admin:script_logs.event", evt)
	scriptLogSubsMu.RLock()
	conns := scriptLogSubs[key]
	for conn := range conns {
		_ = conn.WriteJSON(notification)
	}
	scriptLogSubsMu.RUnlock()
}
