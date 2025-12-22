package forward

import (
	"fmt"
	"log"
	"net"
	"sync"
	"time"
)

type nodeHealth struct {
	Healthy   bool
	LatencyMs int64
	UpdatedAt time.Time
}

// HealthChecker 简单健康检测与状态缓存
type HealthChecker struct {
	mu     sync.Mutex
	status map[string]nodeHealth // key: ruleID-nodeID
}

func NewHealthChecker() *HealthChecker {
	return &HealthChecker{
		status: make(map[string]nodeHealth),
	}
}

func key(ruleID uint, nodeID string) string {
	return fmt.Sprintf("%d-%s", ruleID, nodeID)
}

// RecordStatus 更新健康状态
func (h *HealthChecker) RecordStatus(ruleID uint, nodeID string, healthy bool, latencyMs int64) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.status[key(ruleID, nodeID)] = nodeHealth{
		Healthy:   healthy,
		LatencyMs: latencyMs,
		UpdatedAt: time.Now(),
	}
}

// GetStatus 获取健康状态
func (h *HealthChecker) GetStatus(ruleID uint, nodeID string) (nodeHealth, bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	v, ok := h.status[key(ruleID, nodeID)]
	return v, ok
}

// EvaluatePriority 依据 priority 策略决定是否切换活跃节点（占位，需与主控回传联动）
func (h *HealthChecker) EvaluatePriority(ruleID uint, relays []RelayNode, activeID string) string {
	// 简单实现：若当前活跃节点不健康，选择 sort_order 最小的健康节点
	if len(relays) == 0 {
		return activeID
	}
	if st, ok := h.GetStatus(ruleID, activeID); ok {
		if st.Healthy {
			return activeID
		}
	}
	// 选择健康的最小 sort_order
	var candidate *RelayNode
	for i := range relays {
		r := relays[i]
		if st, ok := h.GetStatus(ruleID, r.NodeID); ok && st.Healthy {
			if candidate == nil || r.SortOrder < candidate.SortOrder {
				candidate = &r
			}
		}
	}
	if candidate == nil {
		log.Printf("rule %d priority: no healthy relay found, keep %s", ruleID, activeID)
		return activeID
	}
	return candidate.NodeID
}

// PingLatencyWithProtocol 根据协议测试延迟
func PingLatencyWithProtocol(protocol string, target string, timeout time.Duration) (int64, bool) {
	network := normalizeProtocol(protocol)
	start := time.Now()
	conn, err := net.DialTimeout(network, target, timeout)
	if err != nil {
		return 0, false
	}
	_ = conn.SetDeadline(time.Now().Add(timeout))
	if network == "udp" {
		_, _ = conn.Write([]byte{0})
	}
	_ = conn.Close()
	return time.Since(start).Milliseconds(), true
}

// PingLatency 兼容旧调用（默认 TCP）
func PingLatency(target string, timeout time.Duration) (int64, bool) {
	return PingLatencyWithProtocol("tcp", target, timeout)
}
