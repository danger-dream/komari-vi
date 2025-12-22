package forward

import (
	"log"
	"time"

	"github.com/komari-monitor/komari-agent/ws"
)

// sendForwardStats 发送一次 forward_stats 上报
func sendForwardStats(conn *ws.SafeConn, ruleID uint, nodeID string, port int, status string, inBytes, outBytes, bpsIn, bpsOut int64, latency int64, activeConns int) {
	if conn == nil {
		return
	}
	payload := map[string]interface{}{
		"type":                 "forward_stats",
		"rule_id":              ruleID,
		"node_id":              nodeID,
		"link_status":          status,
		"active_connections":   activeConns,
		"traffic_in_bytes":     inBytes,
		"traffic_out_bytes":    outBytes,
		"realtime_bps_in":      bpsIn,
		"realtime_bps_out":     bpsOut,
		"active_relay_node_id": "",
		"nodes_latency":        map[string]int64{"self": latency},
		"last_updated_at":      time.Now().UTC(),
		"port":                 port,
	}
	if err := conn.WriteJSON(payload); err != nil {
		log.Printf("send forward_stats failed: %v", err)
	}
}
