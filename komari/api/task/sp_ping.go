package task

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/komari-monitor/komari/api"
	"github.com/komari-monitor/komari/database/tasks"
)

type PublicSPPingTask struct {
	Id          uint     `json:"id"`
	Name        string   `json:"name"`
	Clients     []string `json:"clients"`
	Type        string   `json:"type"`
	Step        int      `json:"step"`
	Pings       int      `json:"pings"`
	TimeoutMS   int      `json:"timeout_ms"`
	PayloadSize int      `json:"payload_size"`
}

func GetPublicSPPingTasks(c *gin.Context) {
	ts, err := tasks.GetAllSPPingTasks()
	if err != nil {
		api.RespondError(c, http.StatusInternalServerError, err.Error())
		return
	}
	publicTasks := make([]PublicSPPingTask, len(ts))
	for i, t := range ts {
		publicTasks[i] = PublicSPPingTask{
			Id:          t.Id,
			Name:        t.Name,
			Clients:     t.Clients,
			Type:        t.Type,
			Step:        t.Step,
			Pings:       t.Pings,
			TimeoutMS:   t.TimeoutMS,
			PayloadSize: t.PayloadSize,
		}
	}
	api.RespondSuccess(c, publicTasks)
}
