package api

import (
	"log"

	"github.com/gorilla/websocket"
)

func sendLgStartPayload(session *LgSession) error {
	payload := map[string]interface{}{
		"type":    "start",
		"tool":    session.Tool,
		"input":   session.Input,
		"timeout": session.Timeout,
		"command": session.Command,
		"ip":      session.DisplayIP,
		"port":    session.DisplayPort,
	}
	return session.Agent.WriteJSON(payload)
}

func ForwardLg(id string) {
	LgSessionsMutex.Lock()
	session, exists := LgSessions[id]
	LgSessionsMutex.Unlock()
	if !exists || session == nil {
		return
	}
	if session.Agent == nil || session.Browser == nil {
		return
	}

	// 发送启动指令
	if err := sendLgStartPayload(session); err != nil {
		log.Println("failed to send LG start payload:", err)
		session.Browser.WriteMessage(websocket.TextMessage, []byte("[lg] 下发命令失败\n"))
		return
	}

	errChan := make(chan error, 2)

	// Browser -> Agent (停止信号)
	go func() {
		for {
			msgType, data, err := session.Browser.ReadMessage()
			if err != nil {
				errChan <- err
				return
			}
			if session.Agent != nil {
				_ = session.Agent.WriteMessage(msgType, data)
			}
		}
	}()

	// Agent -> Browser (输出)
	go func() {
		for {
			msgType, data, err := session.Agent.ReadMessage()
			if err != nil {
				errChan <- err
				return
			}
			if session.Browser != nil {
				_ = session.Browser.WriteMessage(msgType, data)
			}
		}
	}()

	<-errChan
	if session.Agent != nil {
		session.Agent.Close()
	}
	if session.Browser != nil {
		session.Browser.Close()
	}
	LgSessionsMutex.Lock()
	delete(LgSessions, id)
	LgSessionsMutex.Unlock()
}
