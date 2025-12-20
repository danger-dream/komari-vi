package admin

import (
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/komari-monitor/komari/api"
	"github.com/komari-monitor/komari/database/auditlog"
	"github.com/komari-monitor/komari/database/tasks"
)

// OrderPingTask 调整 Ping 任务顺序
func OrderPingTask(c *gin.Context) {
	var req map[string]int
	if err := c.ShouldBindJSON(&req); err != nil {
		api.RespondError(c, 400, "Invalid or missing request body: "+err.Error())
		return
	}

	weights := make(map[uint]int)
	for rawID, weight := range req {
		id, err := strconv.Atoi(rawID)
		if err != nil {
			api.RespondError(c, 400, "Invalid task id: "+rawID)
			return
		}
		weights[uint(id)] = weight
	}

	if err := tasks.OrderPingTasks(weights); err != nil {
		api.RespondError(c, 500, "Failed to update ping task order: "+err.Error())
		return
	}
	uuid, _ := c.Get("uuid")
	auditlog.Log(c.ClientIP(), uuid.(string), "order ping tasks", "info")
	api.RespondSuccess(c, nil)
}
