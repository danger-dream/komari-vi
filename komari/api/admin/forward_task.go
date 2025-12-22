package admin

import (
	"encoding/json"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/komari-monitor/komari/api"
	"github.com/komari-monitor/komari/forward"
	"github.com/komari-monitor/komari/utils"
	"github.com/komari-monitor/komari/ws"
)

// RunAgentTask 下发通用转发任务到指定节点
func RunAgentTask(c *gin.Context) {
	var req struct {
		NodeIDs  []string         `json:"node_ids" binding:"required"`
		TaskType forward.TaskType `json:"task_type" binding:"required"`
		Payload  json.RawMessage  `json:"payload" binding:"required"`
		Timeout  int              `json:"timeout"` // 秒
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		api.RespondError(c, 400, err.Error())
		return
	}
	timeout := time.Duration(req.Timeout) * time.Second
	if timeout <= 0 {
		timeout = 15 * time.Second
	}

	conns := ws.GetConnectedClients()
	results := make([]forward.AgentTaskResult, 0, len(req.NodeIDs))
	for _, nodeID := range req.NodeIDs {
		conn := conns[nodeID]
		if conn == nil {
			results = append(results, forward.AgentTaskResult{
				NodeID:  nodeID,
				Success: false,
				Message: "client offline",
			})
			continue
		}
		taskID := utils.GenerateRandomString(16)
		forward.RegisterWaiter(taskID)
		env := forward.TaskEnvelope{
			TaskID:   taskID,
			TaskType: req.TaskType,
			Payload:  req.Payload,
		}
		payload := struct {
			Message string               `json:"message"`
			Task    forward.TaskEnvelope `json:"task"`
		}{
			Message: "forward_task",
			Task:    env,
		}
		if err := conn.WriteJSON(payload); err != nil {
			results = append(results, forward.AgentTaskResult{
				NodeID:  nodeID,
				TaskID:  taskID,
				Success: false,
				Message: "write ws failed: " + err.Error(),
			})
			continue
		}
		res, err := forward.WaitResult(taskID, timeout)
		if err != nil {
			results = append(results, forward.AgentTaskResult{
				NodeID:  nodeID,
				TaskID:  taskID,
				Success: false,
				Message: err.Error(),
			})
			continue
		}
		res.NodeID = nodeID
		results = append(results, res)
	}

	api.RespondSuccess(c, results)
}
