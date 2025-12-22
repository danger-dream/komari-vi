package forward

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/komari-monitor/komari/utils"
	"github.com/komari-monitor/komari/ws"
)

// SendTaskToNode 将任务通过 WS 下发到指定 Agent 并等待响应
func SendTaskToNode(nodeID string, taskType TaskType, payload interface{}, timeout time.Duration) (AgentTaskResult, error) {
	if timeout <= 0 {
		timeout = 15 * time.Second
	}
	conn := ws.GetConnectedClients()[nodeID]
	if conn == nil {
		return AgentTaskResult{NodeID: nodeID, Success: false, Message: "client offline"}, fmt.Errorf("client %s offline", nodeID)
	}
	taskID := utils.GenerateRandomString(16)
	RegisterWaiter(taskID)

	var raw json.RawMessage
	if payload != nil {
		b, err := json.Marshal(payload)
		if err != nil {
			return AgentTaskResult{}, err
		}
		raw = b
	}
	env := TaskEnvelope{
		TaskID:   taskID,
		TaskType: taskType,
		Payload:  raw,
	}
	msg := map[string]interface{}{
		"message": "forward_task",
		"task":    env,
	}
	if err := conn.WriteJSON(msg); err != nil {
		return AgentTaskResult{TaskID: taskID, NodeID: nodeID, Success: false, Message: err.Error()}, err
	}
	res, err := WaitResult(taskID, timeout)
	if err != nil {
		return AgentTaskResult{TaskID: taskID, NodeID: nodeID, Success: false, Message: err.Error()}, err
	}
	res.NodeID = nodeID
	return res, nil
}
