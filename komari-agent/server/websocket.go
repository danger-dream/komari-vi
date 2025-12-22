package server

import (
	"crypto/tls"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	"github.com/komari-monitor/komari-agent/dnsresolver"
	"github.com/komari-monitor/komari-agent/forward"
	"github.com/komari-monitor/komari-agent/monitoring"
	"github.com/komari-monitor/komari-agent/terminal"
	"github.com/komari-monitor/komari-agent/utils"
	"github.com/komari-monitor/komari-agent/ws"
)

func EstablishWebSocketConnection() {

	websocketEndpoint := strings.TrimSuffix(flags.Endpoint, "/") + "/api/clients/report?token=" + flags.Token
	websocketEndpoint = "ws" + strings.TrimPrefix(websocketEndpoint, "http")

	// 转换中文域名为 ASCII 兼容编码
	if convertedEndpoint, err := utils.ConvertIDNToASCII(websocketEndpoint); err == nil {
		websocketEndpoint = convertedEndpoint
	} else {
		log.Printf("Warning: Failed to convert WebSocket IDN to ASCII: %v", err)
	}

	var conn *ws.SafeConn
	defer func() {
		if conn != nil {
			conn.Close()
		}
	}()
	var err error
	var interval float64
	if flags.Interval <= 1 {
		interval = 1
	} else {
		interval = flags.Interval - 1
	}

	dataTicker := time.NewTicker(time.Duration(interval * float64(time.Second)))
	defer dataTicker.Stop()

	heartbeatTicker := time.NewTicker(30 * time.Second)
	defer heartbeatTicker.Stop()

	for {
		select {
		case <-dataTicker.C:
			if conn == nil {
				log.Println("Attempting to connect to WebSocket...")
				retry := 0
				for retry <= flags.MaxRetries {
					if retry > 0 {
						log.Println("Retrying websocket connection, attempt:", retry)
					}
					conn, err = connectWebSocket(websocketEndpoint)
					if err == nil {
						log.Println("WebSocket connected")
						go handleWebSocketMessages(conn, make(chan struct{}))
						break
					} else {
						log.Println("Failed to connect to WebSocket:", err)
					}
					retry++
					time.Sleep(time.Duration(flags.ReconnectInterval) * time.Second)
				}

				if retry > flags.MaxRetries {
					log.Println("Max retries reached.")
					return
				}
			}

			data := monitoring.GenerateReport()
			err = conn.WriteMessage(websocket.TextMessage, data)
			if err != nil {
				log.Println("Failed to send WebSocket message:", err)
				conn.Close()
				conn = nil // Mark connection as dead
				continue
			}
		case <-heartbeatTicker.C:
			if conn != nil {
				err := conn.WriteMessage(websocket.PingMessage, nil)
				if err != nil {
					log.Println("Failed to send heartbeat:", err)
					conn.Close()
					conn = nil // Mark connection as dead
				}
			}
		}
	}
}

func connectWebSocket(websocketEndpoint string) (*ws.SafeConn, error) {
	dialer := newWSDialer()

	headers := newWSHeaders()

	conn, resp, err := dialer.Dial(websocketEndpoint, headers)
	if err != nil {
		if resp != nil && resp.StatusCode != 101 {
			return nil, fmt.Errorf("%s", resp.Status)
		}
		return nil, err
	}

	return ws.NewSafeConn(conn), nil
}

func handleWebSocketMessages(conn *ws.SafeConn, done chan<- struct{}) {
	defer close(done)
	for {
		_, message_raw, err := conn.ReadMessage()
		if err != nil {
			log.Println("WebSocket read error:", err)
			return
		}
		var message wsMessage
		err = json.Unmarshal(message_raw, &message)
		if err != nil {
			log.Println("Bad ws message:", err)
			continue
		}

		// Looking-Glass 优先判断，避免 request_id 被当作 terminal
		if message.Message == "lg" {
			id := message.LgRequest
			if id == "" {
				id = message.TerminalId
			}
			go establishLgConnection(flags.Token, id, flags.Endpoint)
			continue
		}
		if message.Message == "terminal" || message.TerminalId != "" {
			go establishTerminalConnection(flags.Token, message.TerminalId, flags.Endpoint)
			continue
		}
		if message.Message == "exec" {
			go NewTask(message.ExecTaskID, message.ExecCommand)
			continue
		}
		if message.Message == "script_stop" && message.ScriptExecID != "" {
			scriptCancelMu.Lock()
			cancelFunc, ok := scriptCancelMap[message.ScriptExecID]
			scriptCancelMu.Unlock()
			if ok {
				cancelFunc()
			}
			continue
		}
		if message.Message == "script" && message.ScriptBody != "" {
			go RunScriptFromMessage(conn, &message)
			continue
		}
		if message.Message == "forward_task" && message.Task.TaskID != "" {
			go handleForwardTask(conn, message.Task)
			continue
		}
		if message.Message == "ping" || message.PingTaskID != 0 || message.PingType != "" || message.PingTarget != "" {
			go NewPingTask(conn, message.PingTaskID, message.PingType, message.PingTarget)
			continue
		}
		if message.Message == "sp_ping" || message.SPPingTaskID != 0 || message.SPPingType != "" || message.SPPingTarget != "" {
			go NewSPPingTask(conn, message.SPPingTaskID, message.SPPingType, message.SPPingTarget, message.SPPings, message.SPTimeoutMS, message.SPPayload)
			continue
		}
	}
}

// connectWebSocket attempts to establish a WebSocket connection and upload basic info

// establishTerminalConnection 建立终端连接并使用terminal包处理终端操作
func establishTerminalConnection(token, id, endpoint string) {
	endpoint = strings.TrimSuffix(endpoint, "/") + "/api/clients/terminal?token=" + token + "&id=" + id
	endpoint = "ws" + strings.TrimPrefix(endpoint, "http")

	// 转换中文域名为 ASCII 兼容编码
	if convertedEndpoint, err := utils.ConvertIDNToASCII(endpoint); err == nil {
		endpoint = convertedEndpoint
	} else {
		log.Printf("Warning: Failed to convert Terminal WebSocket IDN to ASCII: %v", err)
	}

	// 使用与主 WS 相同的拨号策略
	dialer := newWSDialer()

	headers := newWSHeaders()

	conn, _, err := dialer.Dial(endpoint, headers)
	if err != nil {
		log.Println("Failed to establish terminal connection:", err)
		return
	}

	// 启动终端
	terminal.StartTerminal(conn)
	if conn != nil {
		conn.Close()
	}
}

func handleForwardTask(conn *ws.SafeConn, task forward.TaskEnvelope) {
	manager := forward.NewManager()
	respPayload, err := manager.HandleTask(conn, task)
	success := err == nil
	msg := ""
	if err != nil {
		msg = err.Error()
	}
	var payload json.RawMessage
	if respPayload != nil {
		if b, e := json.Marshal(respPayload); e == nil {
			payload = b
		} else {
			msg = fmt.Sprintf("marshal response failed: %v", e)
			success = false
		}
	}
	result := map[string]interface{}{
		"message":   "forward_task_result",
		"task_id":   task.TaskID,
		"task_type": task.TaskType,
		"success":   success,
		"detail":    msg,
	}
	if len(payload) > 0 {
		result["payload"] = json.RawMessage(payload)
	}
	if err := conn.WriteJSON(result); err != nil {
		log.Printf("send forward_task_result failed: %v", err)
	}
}

// establishLgConnection 建立 LG 会话
func establishLgConnection(token, id, endpoint string) {
	if id == "" {
		return
	}
	url := strings.TrimSuffix(endpoint, "/") + "/api/clients/lg?token=" + token + "&id=" + id
	url = "ws" + strings.TrimPrefix(url, "http")

	if convertedEndpoint, err := utils.ConvertIDNToASCII(url); err == nil {
		url = convertedEndpoint
	} else {
		log.Printf("Warning: Failed to convert LG WebSocket IDN to ASCII: %v", err)
	}

	dialer := newWSDialer()
	headers := newWSHeaders()

	conn, _, err := dialer.Dial(url, headers)
	if err != nil {
		log.Println("Failed to establish LG connection:", err)
		return
	}
	startLg(conn)
	if conn != nil {
		conn.Close()
	}
}

// newWSDialer 构造统一的 WebSocket 拨号器（自定义解析、IPv4/IPv6 动态排序、可选 TLS 忽略）
func newWSDialer() *websocket.Dialer {
	d := &websocket.Dialer{
		HandshakeTimeout: 15 * time.Second,
		NetDialContext:   dnsresolver.GetDialContext(15 * time.Second),
	}
	if flags.IgnoreUnsafeCert {
		d.TLSClientConfig = &tls.Config{InsecureSkipVerify: true}
	}
	return d
}

// newWSHeaders 统一构造 WS 请求头（含 Cloudflare Access 头）
func newWSHeaders() http.Header {
	headers := http.Header{}
	if flags.CFAccessClientID != "" && flags.CFAccessClientSecret != "" {
		headers.Set("CF-Access-Client-Id", flags.CFAccessClientID)
		headers.Set("CF-Access-Client-Secret", flags.CFAccessClientSecret)
	}
	return headers
}
