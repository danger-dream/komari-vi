package forward

import (
	"encoding/json"
	"errors"
	"sync"
	"time"
)

// AgentTaskResult 用于主控等待 Agent 响应
type AgentTaskResult struct {
	TaskID   string          `json:"task_id"`
	TaskType TaskType        `json:"task_type"`
	NodeID   string          `json:"node_id"`
	Success  bool            `json:"success"`
	Message  string          `json:"message"`
	Payload  json.RawMessage `json:"payload"`
}

var (
	waitersMu sync.Mutex
	waiters   = make(map[string]chan AgentTaskResult)
)

// RegisterWaiter 为 taskID 创建等待通道
func RegisterWaiter(taskID string) chan AgentTaskResult {
	waitersMu.Lock()
	defer waitersMu.Unlock()
	ch := make(chan AgentTaskResult, 1)
	waiters[taskID] = ch
	return ch
}

// completeResult 投递 Agent 返回结果
func CompleteResult(res AgentTaskResult) {
	waitersMu.Lock()
	ch, ok := waiters[res.TaskID]
	if ok {
		delete(waiters, res.TaskID)
	}
	waitersMu.Unlock()
	if ok {
		ch <- res
	}
}

// WaitResult 等待结果或超时
func WaitResult(taskID string, timeout time.Duration) (AgentTaskResult, error) {
	waitersMu.Lock()
	ch, ok := waiters[taskID]
	waitersMu.Unlock()
	if !ok {
		return AgentTaskResult{}, errors.New("waiter not found")
	}
	select {
	case res := <-ch:
		return res, nil
	case <-time.After(timeout):
		return AgentTaskResult{}, errors.New("timeout waiting agent result")
	}
}
