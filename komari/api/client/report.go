package client

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"time"

	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/komari-monitor/komari/api"
	jsonRpc "github.com/komari-monitor/komari/api/jsonRpc"
	"github.com/komari-monitor/komari/common"
	"github.com/komari-monitor/komari/database/clients"
	dbforward "github.com/komari-monitor/komari/database/forward"
	"github.com/komari-monitor/komari/database/models"
	scriptdb "github.com/komari-monitor/komari/database/script"
	"github.com/komari-monitor/komari/database/tasks"
	"github.com/komari-monitor/komari/forward"
	"github.com/komari-monitor/komari/utils/notifier"
	"github.com/komari-monitor/komari/ws"
	"github.com/patrickmn/go-cache"
	"gorm.io/gorm"
)

const (
	// 如果超过这个时间没有收到任何消息，则认为连接已死
	// 因为目前server没有存agent的信息上报间隔。只有写一个默认的
	readWait = 11 * time.Second
)

func UploadReport(c *gin.Context) {
	bodyBytes, err := io.ReadAll(c.Request.Body)
	if err != nil {
		log.Println("Failed to read request body:", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	var data map[string]interface{}
	err = json.Unmarshal(bodyBytes, &data)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}
	// Save report to database
	var report common.Report
	err = json.Unmarshal(bodyBytes, &report)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}
	report.UpdatedAt = time.Now()
	err = SaveClientReport(report.UUID, report)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("%v", err)})
		return
	}
	// Update report with method and token

	ws.SetLatestReport(report.UUID, &report)

	c.Request.Body = io.NopCloser(bytes.NewBuffer(bodyBytes)) // Restore the body for further use
	c.JSON(200, gin.H{"status": "success"})
}

func WebSocketReport(c *gin.Context) {
	// 升级ws
	if !websocket.IsWebSocketUpgrade(c.Request) {
		c.JSON(http.StatusBadRequest, gin.H{"status": "error", "error": "Require WebSocket upgrade"})
		return
	}
	upgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			return true // 被控
		},
	}
	// Upgrade the HTTP connection to a WebSocket connection
	unsafeConn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"status": "error", "error": "Failed to upgrade to WebSocket"})
		return
	}
	conn := ws.NewSafeConn(unsafeConn)
	defer conn.Close()

	_, message, err := conn.ReadMessage()
	if err != nil {
		log.Println("Error reading message:", err)
		return
	}

	// 第一次数据拿token
	data := map[string]interface{}{}
	err = json.Unmarshal(message, &data)
	if err != nil {
		conn.WriteJSON(gin.H{"status": "error", "error": "Invalid JSON"})
		return
	}
	// it should ok,token was verfied in the middleware
	token := ""
	var errMsg string

	// 优先检查查询参数中的 token
	token = c.Query("token")

	// 如果 token 为空，返回错误
	if token == "" {
		conn.WriteJSON(gin.H{"status": "error", "error": errMsg})
		return
	}

	uuid, err := clients.GetClientUUIDByToken(token)
	if err != nil {
		conn.WriteJSON(gin.H{"status": "error", "error": errMsg})
		return
	}

	// 接受新连接，并处理旧连接
	if oldConn, exists := ws.GetConnectedClients()[uuid]; exists {
		log.Printf("Client %s is reconnecting. Closing the old connection.", uuid)

		// 强制关闭旧连接。这将导致旧连接的 ReadMessage() 循环出错退出。
		go oldConn.Close()
	}
	ws.SetConnectedClients(uuid, conn)
	log.Printf("Client %s is reconnect success, connID: %d", uuid, conn.ID)
	// 处理待发送的停止指令
	if stops := ws.DrainPendingStops(uuid); len(stops) > 0 {
		for _, st := range stops {
			_ = conn.WriteJSON(map[string]interface{}{
				"message":   "script_stop",
				"script_id": st.ScriptID,
				"exec_id":   st.ExecID,
			})
		}
	}
	go notifier.OnlineNotification(uuid, conn.ID)
	defer func() {
		ws.DeleteClientConditionally(uuid, conn)
		notifier.OfflineNotification(uuid, conn.ID)
	}()

	// 首先处理第一次ws conn收到的消息
	processMessage(conn, message, uuid)

	for {
		conn.SetReadDeadline(time.Now().Add(readWait))

		_, message, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("Client %s connection error: %v", uuid, err)
			}
			break // 任何读错误（包括超时）都意味着连接已断开，退出循环
		}
		processMessage(conn, message, uuid)
	}
}

// 将消息处理逻辑提取到一个函数中，方便复用
func processMessage(conn *ws.SafeConn, message []byte, uuid string) {
	type MessageType struct {
		Type string `json:"type"`
	}
	var msgType MessageType
	err := json.Unmarshal(message, &msgType)
	if err != nil {
		conn.WriteJSON(gin.H{"status": "error", "error": "Invalid JSON"})
		return
	}

	switch msgType.Type {
	case "", "report":
		report := common.Report{}
		err = json.Unmarshal(message, &report)
		if err != nil {
			conn.WriteJSON(gin.H{"status": "error", "error": "Invalid report format"})
			return
		}
		report.UpdatedAt = time.Now()
		err = SaveClientReport(uuid, report)
		if err != nil {
			conn.WriteJSON(gin.H{"status": "error", "error": fmt.Sprintf("%v", err)})
			return
		}
		ws.SetLatestReport(uuid, &report)
	case "ping_result":
		var reqBody struct {
			PingTaskID uint      `json:"task_id"`
			PingResult int       `json:"value"`
			FinishedAt time.Time `json:"finished_at"`
		}
		err = json.Unmarshal(message, &reqBody)
		if err != nil {
			conn.WriteJSON(gin.H{"status": "error", "error": "Invalid ping result format"})
			return
		}
		pingResult := models.PingRecord{
			Client: uuid,
			TaskId: reqBody.PingTaskID,
			Value:  reqBody.PingResult,
			Time:   models.FromTime(reqBody.FinishedAt),
		}
		tasks.SavePingRecord(pingResult)
	case "sp_ping_result":
		var reqBody struct {
			TaskID   uint      `json:"task_id"`
			Median   float64   `json:"median"`
			Min      float64   `json:"min"`
			Max      float64   `json:"max"`
			P10      float64   `json:"p10"`
			P90      float64   `json:"p90"`
			Loss     int       `json:"loss"`
			Total    int       `json:"total"`
			Samples  []float64 `json:"samples"`
			Finished time.Time `json:"finished_at"`
			Step     int       `json:"step"`
			Pings    int       `json:"pings"`
			Bucket   int       `json:"bucket_step"`
		}
		if err := json.Unmarshal(message, &reqBody); err != nil {
			conn.WriteJSON(gin.H{"status": "error", "error": "Invalid sp ping result format"})
			return
		}
		taskMeta, _ := tasks.GetSPPingTaskByID(reqBody.TaskID)
		step := reqBody.Step
		pings := reqBody.Pings
		if taskMeta != nil {
			step = taskMeta.Step
			pings = taskMeta.Pings
		}
		bucketStep := reqBody.Bucket
		if bucketStep == 0 {
			bucketStep = step
		}
		sampleJSON, _ := json.Marshal(reqBody.Samples)
		rec := models.SPPingRecord{
			Client:     uuid,
			TaskId:     reqBody.TaskID,
			Time:       models.FromTime(reqBody.Finished),
			Step:       step,
			Pings:      pings,
			Median:     reqBody.Median,
			Min:        reqBody.Min,
			Max:        reqBody.Max,
			P10:        reqBody.P10,
			P90:        reqBody.P90,
			Loss:       reqBody.Loss,
			Total:      reqBody.Total,
			BucketStep: bucketStep,
			Samples:    sampleJSON,
		}
		_ = tasks.SaveSPPingRecord(&rec)
	case "script_log":
		var reqBody struct {
			ScriptID uint   `json:"script_id"`
			ExecID   string `json:"exec_id"`
			Level    string `json:"level"`
			Message  string `json:"message"`
			Time     string `json:"time"`
		}
		if err := json.Unmarshal(message, &reqBody); err != nil {
			conn.WriteJSON(gin.H{"status": "error", "error": "Invalid script log format"})
			return
		}
		logTime := time.Now()
		if reqBody.Time != "" {
			if t, err := time.Parse(time.RFC3339, reqBody.Time); err == nil {
				logTime = t
			}
		}
		entry := models.ScriptLogEntry{
			Time:    models.FromTime(logTime),
			Type:    reqBody.Level,
			Content: reqBody.Message,
		}
		if err := scriptdb.AppendHistoryOutput(reqBody.ScriptID, reqBody.ExecID, uuid, entry); err != nil && err != gorm.ErrRecordNotFound {
			log.Printf("failed to append script log to history: %v", err)
		}
		jsonRpc.PublishScriptLog(jsonRpc.ScriptLogEvent{
			ScriptID:   reqBody.ScriptID,
			ExecID:     reqBody.ExecID,
			Level:      reqBody.Level,
			Message:    reqBody.Message,
			Time:       reqBody.Time,
			ClientUUID: uuid,
		})
	case "forward_task_result":
		var resp struct {
			TaskID   string          `json:"task_id"`
			TaskType string          `json:"task_type"`
			Success  bool            `json:"success"`
			Message  string          `json:"message"`
			Payload  json.RawMessage `json:"payload"`
		}
		if err := json.Unmarshal(message, &resp); err != nil {
			conn.WriteJSON(gin.H{"status": "error", "error": "Invalid forward task result format"})
			return
		}
		forward.CompleteResult(forward.AgentTaskResult{
			TaskID:   resp.TaskID,
			TaskType: forward.TaskType(resp.TaskType),
			NodeID:   uuid,
			Success:  resp.Success,
			Message:  resp.Message,
			Payload:  resp.Payload,
		})
	case "forward_config_sync":
		var payload struct {
			RuleID            uint                   `json:"rule_id"`
			NodeID            string                 `json:"node_id"`
			RealmConfig       string                 `json:"realm_config"`
			ConfigJSONUpdates map[string]interface{} `json:"config_json_updates"`
			Reason            string                 `json:"reason"`
		}
		if err := json.Unmarshal(message, &payload); err != nil {
			conn.WriteJSON(gin.H{"status": "error", "error": "Invalid forward config sync format"})
			return
		}
		go func() {
			if err := forward.ApplyConfigSync(payload.RuleID, payload.NodeID, payload.RealmConfig, payload.ConfigJSONUpdates, payload.Reason); err != nil {
				log.Printf("apply forward config sync failed: %v", err)
			}
		}()
	case "forward_stats":
		var payload models.ForwardStat
		if err := json.Unmarshal(message, &payload); err != nil {
			conn.WriteJSON(gin.H{"status": "error", "error": "Invalid forward stats format"})
			return
		}
		if payload.RuleID == 0 || payload.NodeID == "" {
			conn.WriteJSON(gin.H{"status": "error", "error": "Missing rule_id or node_id"})
			return
		}
		_ = dbforward.UpsertForwardStat(&payload)
		forward.UpdateStatsAndBroadcast(&payload)
	default:
		log.Printf("Unknown message type: %s", msgType.Type)
		conn.WriteJSON(gin.H{"status": "error", "error": "Unknown message type"})
	}
}

func SaveClientReport(uuid string, report common.Report) error {
	reports, _ := api.Records.Get(uuid)
	if reports == nil {
		reports = []common.Report{}
	}
	if report.CPU.Usage < 0.01 {
		report.CPU.Usage = 0.01
	}
	reports = append(reports.([]common.Report), report)
	api.Records.Set(uuid, reports, cache.DefaultExpiration)

	return nil
}
