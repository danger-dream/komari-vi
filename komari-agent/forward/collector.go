package forward

import (
	"fmt"
	"os/exec"
	"strings"
	"time"

	"github.com/komari-monitor/komari-agent/ws"
)

// StatsCollector 周期性采集连接/流量与健康信息
type StatsCollector struct {
	health    *HealthChecker
	interval  time.Duration
	stop      chan struct{}
	prevIn    iptCounters
	prevOut   iptCounters
	prevStamp time.Time
	smoothIn  int64
	smoothOut int64
	alpha     float64
	linkMonitor *LinkHealthMonitor
}

func NewStatsCollector(health *HealthChecker, intervalSec int) *StatsCollector {
	iv := time.Duration(intervalSec) * time.Second
	if iv <= 0 {
		iv = 10 * time.Second
	}
	return &StatsCollector{
		health:    health,
		interval:  iv,
		stop:      make(chan struct{}),
		prevStamp: time.Now(),
		alpha:     0.3,
	}
}

func (c *StatsCollector) Stop() {
	select {
	case <-c.stop:
	default:
		close(c.stop)
	}
}

// StartLoop 启动采集/上报循环
func (c *StatsCollector) StartLoop(conn *ws.SafeConn, ruleID uint, nodeID string, port int, protocol string) {
	if conn == nil {
		return
	}
	ticker := time.NewTicker(c.interval)
	defer ticker.Stop()
	for {
		select {
		case <-c.stop:
			return
		case <-ticker.C:
			c.pollOnce(conn, ruleID, nodeID, port, protocol)
		}
	}
}

func (c *StatsCollector) pollOnce(conn *ws.SafeConn, ruleID uint, nodeID string, port int, protocol string) {
	latency, ok := PingLatencyWithProtocol(protocol, fmt.Sprintf("127.0.0.1:%d", port), 2*time.Second)
	healthy := ok
	c.health.RecordStatus(ruleID, nodeID, healthy, latency)
	status := "healthy"
	if !healthy {
		status = "faulty"
	}
	if c.linkMonitor != nil {
		if linkStatus := c.linkMonitor.Status(); linkStatus != "" {
			if healthy {
				status = linkStatus
			} else if linkStatus == "faulty" {
				status = linkStatus
			}
		}
	}

	in, out, err := ReadPortCounters(ruleID, port, protocol)
	if err != nil {
		in = iptCounters{}
		out = iptCounters{}
	}
	now := time.Now()
	delta := now.Sub(c.prevStamp).Seconds()
	var bpsIn, bpsOut int64
	if delta > 0 {
		bpsIn = int64(float64(in.Bytes-c.prevIn.Bytes) * 8 / delta)
		bpsOut = int64(float64(out.Bytes-c.prevOut.Bytes) * 8 / delta)
	}
	bpsIn = c.smoothValue(&c.smoothIn, bpsIn)
	bpsOut = c.smoothValue(&c.smoothOut, bpsOut)
	c.prevIn = in
	c.prevOut = out
	c.prevStamp = now
	activeConns := countActiveConnections(port, protocol)

	sendForwardStats(conn, ruleID, nodeID, port, status, in.Bytes, out.Bytes, bpsIn, bpsOut, latency, activeConns)
}

func (c *StatsCollector) smoothValue(prev *int64, current int64) int64 {
	if c.alpha <= 0 || c.alpha >= 1 {
		return current
	}
	if *prev == 0 {
		*prev = current
		return current
	}
	*prev = int64(float64(*prev)*(1-c.alpha) + float64(current)*c.alpha)
	return *prev
}

func countActiveConnections(port int, protocol string) int {
	total := 0
	for _, proto := range normalizeProtocols(protocol) {
		switch proto {
		case "udp":
			total += countSockets("u", port)
		default:
			total += countSockets("t", port)
		}
	}
	return total
}

func countSockets(protoFlag string, port int) int {
	flag := "-" + protoFlag + "an"
	args := []string{flag, "sport", fmt.Sprintf("= :%d", port)}
	if protoFlag == "t" {
		args = []string{flag, "state", "established", "sport", fmt.Sprintf("= :%d", port)}
	}
	cmd := exec.Command("ss", args...)
	out, err := cmd.Output()
	if err != nil {
		return 0
	}
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	if len(lines) <= 1 {
		return 0
	}
	return len(lines) - 1
}
