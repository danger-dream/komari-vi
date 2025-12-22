package ws

import "github.com/gorilla/websocket"

// BroadcastToUsers 向所有已连接的用户（前端）广播消息
func BroadcastToUsers(message string, payload string) {
	mu.RLock()
	defer mu.RUnlock()
	for _, conn := range ConnectedUsers {
		if conn != nil && conn.WriteMessage(websocket.TextMessage, []byte(payload)) != nil {
			// 忽略单个连接的写入错误
			continue
		}
	}
}
