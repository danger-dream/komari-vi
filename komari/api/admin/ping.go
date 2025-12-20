package admin

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/komari-monitor/komari/api"
	"github.com/komari-monitor/komari/database/models"
	"github.com/komari-monitor/komari/database/tasks"
)

// POST body: clients []string, target, task_type string, interval int
func AddPingTask(c *gin.Context) {
	type addPingTaskItem struct {
		Clients  []string `json:"clients"`
		Name     string   `json:"name"`
		Target   string   `json:"target"`
		TaskType string   `json:"type"`     // icmp, tcp, http
		Interval int      `json:"interval"` // 间隔时间，单位秒
	}
	var req struct {
		Tasks []addPingTaskItem `json:"tasks"`
		addPingTaskItem
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		api.RespondError(c, http.StatusBadRequest, err.Error())
		return
	}

	items := req.Tasks
	if len(items) == 0 {
		items = []addPingTaskItem{req.addPingTaskItem}
	}

	modelTasks := make([]models.PingTask, 0, len(items))
	for i, item := range items {
		clients := item.Clients
		if len(clients) == 0 {
			clients = req.addPingTaskItem.Clients
		}
		interval := item.Interval
		if interval <= 0 {
			interval = req.addPingTaskItem.Interval
		}
		taskType := strings.TrimSpace(item.TaskType)
		if taskType == "" {
			taskType = strings.TrimSpace(req.addPingTaskItem.TaskType)
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
		if interval <= 0 {
			api.RespondError(c, http.StatusBadRequest, "interval must be greater than 0")
			return
		}
		modelTasks = append(modelTasks, models.PingTask{
			Clients:  clients,
			Name:     strings.TrimSpace(item.Name),
			Type:     taskType,
			Target:   strings.TrimSpace(item.Target),
			Interval: interval,
			Weight:   i,
		})
	}

	ids, err := tasks.AddPingTasks(modelTasks)
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

// POST body: id []uint
func DeletePingTask(c *gin.Context) {
	var req struct {
		ID []uint `json:"id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		api.RespondError(c, http.StatusBadRequest, err.Error())
		return
	}

	if err := tasks.DeletePingTask(req.ID); err != nil {
		api.RespondError(c, http.StatusInternalServerError, err.Error())
	} else {
		api.RespondSuccess(c, nil)
	}
}

// POST body: id []uint, updates map[string]interface{}
func EditPingTask(c *gin.Context) {
	var req struct {
		Tasks []*models.PingTask `json:"tasks" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		api.RespondError(c, http.StatusBadRequest, "Invalid request data")
		return
	}

	if err := tasks.EditPingTask(req.Tasks); err != nil {
		api.RespondError(c, http.StatusInternalServerError, err.Error())
	} else {
		// for _, task := range req.Tasks {
		// 	tasks.DeletePingRecords([]uint{task.Id})
		// }
		api.RespondSuccess(c, nil)
	}
}

func GetAllPingTasks(c *gin.Context) {
	tasks, err := tasks.GetAllPingTasks()
	if err != nil {
		api.RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}

	api.RespondSuccess(c, tasks)
}

// ClearPingRecords 清空延迟检测历史数据
func ClearPingRecords(c *gin.Context) {
	if err := tasks.DeleteAllPingRecords(); err != nil {
		api.RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}
	api.RespondSuccess(c, nil)
}
