package forward

import (
	"sync"
	"time"
)

type LinkHealthMonitor struct {
	interval time.Duration
	nextHop  string
	endToEnd string
	protocol string
	stop     chan struct{}
	mu       sync.RWMutex
	status   string
}

func NewLinkHealthMonitor(protocol string, nextHop string, endToEnd string, intervalSec int) *LinkHealthMonitor {
	interval := time.Duration(intervalSec) * time.Second
	if interval <= 0 {
		interval = 10 * time.Second
	}
	return &LinkHealthMonitor{
		interval: interval,
		nextHop:  nextHop,
		endToEnd: endToEnd,
		protocol: protocol,
		stop:     make(chan struct{}),
		status:   "",
	}
}

func (m *LinkHealthMonitor) Start() {
	if m == nil {
		return
	}
	go func() {
		ticker := time.NewTicker(m.interval)
		defer ticker.Stop()
		for {
			select {
			case <-m.stop:
				return
			case <-ticker.C:
				m.checkOnce()
			}
		}
	}()
	m.checkOnce()
}

func (m *LinkHealthMonitor) Stop() {
	if m == nil {
		return
	}
	select {
	case <-m.stop:
		return
	default:
		close(m.stop)
	}
}

func (m *LinkHealthMonitor) Status() string {
	if m == nil {
		return ""
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.status
}

func (m *LinkHealthMonitor) setStatus(status string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.status = status
}

func (m *LinkHealthMonitor) checkOnce() {
	if m == nil {
		return
	}
	nextOK := false
	endOK := false
	if m.nextHop != "" {
		_, nextOK = PingLatencyWithProtocol(m.protocol, m.nextHop, 3*time.Second)
	}
	if m.endToEnd != "" {
		_, endOK = PingLatencyWithProtocol(m.protocol, m.endToEnd, 3*time.Second)
	}

	status := "healthy"
	switch {
	case m.endToEnd != "":
		if endOK {
			status = "healthy"
		} else if nextOK {
			status = "degraded"
		} else {
			status = "faulty"
		}
	default:
		if nextOK {
			status = "healthy"
		} else {
			status = "faulty"
		}
	}
	m.setStatus(status)
}
