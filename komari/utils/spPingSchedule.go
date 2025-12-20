package utils

import (
	"context"
	"sync"
	"time"

	"github.com/komari-monitor/komari/database/models"
	"github.com/komari-monitor/komari/ws"
)

// SPPingTaskManager 管理 SmokePing 风格的定时任务
type SPPingTaskManager struct {
	mu         sync.Mutex
	cancelFunc context.CancelFunc
	tasks      map[int][]models.SPPingTask
}

var spManager = &SPPingTaskManager{
	tasks: make(map[int][]models.SPPingTask),
}

// ReloadSPPingSchedule 加载或重载时间表
func ReloadSPPingSchedule(tasks []models.SPPingTask) error {
	return spManager.Reload(tasks)
}

func (m *SPPingTaskManager) Reload(tasks []models.SPPingTask) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.cancelFunc != nil {
		m.cancelFunc()
	}
	ctx, cancel := context.WithCancel(context.Background())
	m.cancelFunc = cancel
	m.tasks = make(map[int][]models.SPPingTask)

	taskGroups := make(map[int][]models.SPPingTask)
	for _, task := range tasks {
		if task.Step <= 0 {
			continue
		}
		taskGroups[task.Step] = append(taskGroups[task.Step], task)
	}

	for step, group := range taskGroups {
		m.tasks[step] = group
		go m.runPreciseLoop(ctx, time.Duration(step)*time.Second, group)
	}
	return nil
}

func (m *SPPingTaskManager) runPreciseLoop(ctx context.Context, interval time.Duration, tasks []models.SPPingTask) {
	dispatch := func() {
		onlineClients := ws.GetConnectedClients()
		for _, task := range tasks {
			go executeSPPingTask(ctx, task, onlineClients)
		}
	}

	// 先立即执行一次，避免首次等待
	dispatch()

	nextTick := time.Now().Truncate(interval).Add(interval)
	wait := time.Until(nextTick)
	if wait <= 0 {
		wait = interval
		nextTick = time.Now().Add(interval)
	}
	timer := time.NewTimer(wait)
	defer timer.Stop()

	for {
		select {
		case <-timer.C:
			dispatch()
			nextTick = nextTick.Add(interval)
			wait = time.Until(nextTick)
			if wait <= 0 {
				wait = interval
				nextTick = time.Now().Add(interval)
			}
			timer.Reset(wait)
		case <-ctx.Done():
			return
		}
	}
}

func executeSPPingTask(ctx context.Context, task models.SPPingTask, onlineClients map[string]*ws.SafeConn) {
	var message struct {
		TaskID      uint   `json:"sp_ping_task_id"`
		Message     string `json:"message"`
		Type        string `json:"sp_ping_type"`
		Target      string `json:"sp_ping_target"`
		Pings       int    `json:"pings"`
		TimeoutMS   int    `json:"timeout_ms"`
		PayloadSize int    `json:"payload_size"`
	}
	message.Message = "sp_ping"
	message.TaskID = task.Id
	message.Type = task.Type
	message.Target = task.Target
	message.Pings = task.Pings
	message.TimeoutMS = task.TimeoutMS
	message.PayloadSize = task.PayloadSize

	for _, clientUUID := range task.Clients {
		select {
		case <-ctx.Done():
			return
		default:
		}
		if conn, exists := onlineClients[clientUUID]; exists && conn != nil {
			_ = conn.WriteJSON(message)
		}
	}
}
