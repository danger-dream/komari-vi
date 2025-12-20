package client

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/komari-monitor/komari/api"
	"github.com/komari-monitor/komari/ws"
)

// Agent WS: /api/clients/lg
func ClientLgWS(c *gin.Context) {
	sessionID := c.Query("id")
	if sessionID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"status": "error", "error": "missing id"})
		return
	}
	api.LgSessionsMutex.Lock()
	session, exists := api.LgSessions[sessionID]
	api.LgSessionsMutex.Unlock()
	if !exists || session == nil {
		c.JSON(http.StatusNotFound, gin.H{"status": "error", "error": "session not found"})
		return
	}
	conn, err := ws.UpgradeRequest(c, func(r *http.Request) bool { return true })
	if err != nil {
		return
	}
	api.LgSessionsMutex.Lock()
	session.Agent = conn
	api.LgSessionsMutex.Unlock()

	conn.SetReadDeadline(time.Now().Add(time.Duration(session.Timeout) * time.Second))
	conn.SetCloseHandler(func(code int, text string) error {
		api.LgSessionsMutex.Lock()
		delete(api.LgSessions, sessionID)
		api.LgSessionsMutex.Unlock()
		if session.Browser != nil {
			session.Browser.Close()
		}
		return nil
	})

	// 如果浏览器已连接，立即桥接
	go api.ForwardLg(sessionID)
}
