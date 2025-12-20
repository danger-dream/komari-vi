package admin

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/komari-monitor/komari/api"
	"github.com/komari-monitor/komari/database/models"
	"github.com/komari-monitor/komari/database/tasks"
)

// SmokePing 风格延迟任务
func AddSPPingTask(c *gin.Context) {
	type addSPPingTaskItem struct {
		Clients     []string `json:"clients"`
		Name        string   `json:"name"`
		Target      string   `json:"target"`
		TaskType    string   `json:"type"` // icmp tcp http
		Step        int      `json:"step"`
		Pings       int      `json:"pings"`
		TimeoutMS   int      `json:"timeout_ms"`
		PayloadSize int      `json:"payload_size"`
	}
	var req struct {
		Tasks []addSPPingTaskItem `json:"tasks"`
		addSPPingTaskItem
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		api.RespondError(c, http.StatusBadRequest, err.Error())
		return
	}

	items := req.Tasks
	if len(items) == 0 {
		items = []addSPPingTaskItem{req.addSPPingTaskItem}
	}

	modelTasks := make([]models.SPPingTask, 0, len(items))
	for i, item := range items {
		clients := item.Clients
		if len(clients) == 0 {
			clients = req.addSPPingTaskItem.Clients
		}
		taskType := strings.TrimSpace(item.TaskType)
		if taskType == "" {
			taskType = strings.TrimSpace(req.addSPPingTaskItem.TaskType)
		}
		step := item.Step
		if step <= 0 {
			step = req.addSPPingTaskItem.Step
		}
		pings := item.Pings
		if pings <= 0 {
			pings = req.addSPPingTaskItem.Pings
		}
		timeoutMS := item.TimeoutMS
		if timeoutMS <= 0 {
			timeoutMS = req.addSPPingTaskItem.TimeoutMS
		}
		payloadSize := item.PayloadSize
		if payloadSize <= 0 {
			payloadSize = req.addSPPingTaskItem.PayloadSize
		}

		if len(clients) == 0 {
			api.RespondError(c, http.StatusBadRequest, "clients is required")
			return
		}
		if strings.TrimSpace(item.Name) == "" {
			api.RespondError(c, http.StatusBadRequest, "name is required")
			return
		}
		if strings.TrimSpace(item.Target) == "" {
			api.RespondError(c, http.StatusBadRequest, "target is required")
			return
		}
		if taskType == "" {
			api.RespondError(c, http.StatusBadRequest, "type is required")
			return
		}
		modelTasks = append(modelTasks, models.SPPingTask{
			Clients:     clients,
			Name:        strings.TrimSpace(item.Name),
			Type:        taskType,
			Target:      strings.TrimSpace(item.Target),
			Step:        step,
			Pings:       pings,
			TimeoutMS:   timeoutMS,
			PayloadSize: payloadSize,
			Weight:      i,
		})
	}

	ids, err := tasks.AddSPPingTasks(modelTasks)
	if err != nil {
		api.RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}
	if len(ids) == 1 {
		api.RespondSuccess(c, gin.H{"task_id": ids[0]})
		return
	}
	api.RespondSuccess(c, gin.H{"task_ids": ids})
}

func DeleteSPPingTask(c *gin.Context) {
	var req struct {
		ID []uint `json:"id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		api.RespondError(c, http.StatusBadRequest, err.Error())
		return
	}
	if err := tasks.DeleteSPPingTask(req.ID); err != nil {
		api.RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}
	api.RespondSuccess(c, nil)
}

func EditSPPingTask(c *gin.Context) {
	var req struct {
		Tasks []*models.SPPingTask `json:"tasks" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		api.RespondError(c, http.StatusBadRequest, "Invalid request data")
		return
	}
	if err := tasks.EditSPPingTask(req.Tasks); err != nil {
		api.RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}
	api.RespondSuccess(c, nil)
}

func GetAllSPPingTasks(c *gin.Context) {
	ts, err := tasks.GetAllSPPingTasks()
	if err != nil {
		api.RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}
	api.RespondSuccess(c, ts)
}

// ClearSPPingRecords 清空历史数据
func ClearSPPingRecords(c *gin.Context) {
	if err := tasks.DeleteAllSPPingRecords(); err != nil {
		api.RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}
	api.RespondSuccess(c, nil)
}

func OrderSPPingTask(c *gin.Context) {
	var req struct {
		Weights map[uint]int `json:"weights" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		api.RespondError(c, http.StatusBadRequest, "Invalid request data")
		return
	}
	if err := tasks.OrderSPPingTasks(req.Weights); err != nil {
		api.RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}
	api.RespondSuccess(c, nil)
}
