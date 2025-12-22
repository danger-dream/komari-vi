package forward

import (
	"encoding/json"
	"fmt"

	"github.com/komari-monitor/komari-agent/ws"
)

// reportConfigChange 按方案调用主控 config sync 接口（复用 WS 信道发送 message）
func reportConfigChange(conn *ws.SafeConn, ruleID uint, nodeID string, realmConfig string, updates map[string]interface{}, reason string) {
	if conn == nil {
		return
	}
	payload := map[string]interface{}{
		"rule_id":             ruleID,
		"node_id":             nodeID,
		"realm_config":        realmConfig,
		"config_json_updates": updates,
		"reason":              reason,
	}
	msg := map[string]interface{}{
		"message": "forward_config_sync",
		"payload": payload,
	}
	if err := conn.WriteJSON(msg); err != nil {
		fmt.Printf("reportConfigChange failed: %v\n", err)
	}
}

func mustMarshal(v interface{}) json.RawMessage {
	b, _ := json.Marshal(v)
	return b
}
