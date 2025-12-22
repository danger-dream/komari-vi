package forward

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"syscall"
	"time"

	"github.com/komari-monitor/komari-agent/ws"
)

const (
	realmConfigDir = "/etc/komari-agent/realm"
	realmLogDir    = "/var/log/komari-agent"
)

type RealmProcess struct {
	RuleID     uint
	NodeID     string
	Cmd        *exec.Cmd
	ConfigPath string
	LogPath    string
	StartTime  time.Time
	WaitDone   chan struct{}
	logFile    *os.File
	stopStats  chan struct{}
	statsIntv  time.Duration
	port       int
	protocol   string
	collector  *StatsCollector
	linkMonitor *LinkHealthMonitor
	startReq   StartRealmRequest
	conn       *ws.SafeConn
	crashLimit int
	crashCount int
	stopping   bool
}

type ProcessManager struct {
	mu        sync.Mutex
	processes map[string]*RealmProcess
	health    *HealthChecker
}

func NewProcessManager(health *HealthChecker) *ProcessManager {
	return &ProcessManager{
		processes: make(map[string]*RealmProcess),
		health:    health,
	}
}

func statsDuration(sec int) time.Duration {
	if sec <= 0 {
		return 10 * time.Second
	}
	return time.Duration(sec) * time.Second
}

func buildPaths(ruleID uint, nodeID string) (configPath, logPath string) {
	configName := fmt.Sprintf("realm-rule-%d-node-%s.toml", ruleID, nodeID)
	logName := fmt.Sprintf("realm-rule-%d-node-%s.log", ruleID, nodeID)
	return filepath.Join(realmConfigDir, configName), filepath.Join(realmLogDir, logName)
}

func (m *ProcessManager) Start(req StartRealmRequest, conn *ws.SafeConn) (*RealmProcess, error) {
	key := m.key(req.RuleID, req.NodeID)

	if err := os.MkdirAll(realmConfigDir, 0o755); err != nil {
		return nil, fmt.Errorf("create config dir: %w", err)
	}
	if err := os.MkdirAll(realmLogDir, 0o755); err != nil {
		return nil, fmt.Errorf("create log dir: %w", err)
	}

	configPath, logPath := buildPaths(req.RuleID, req.NodeID)
	if err := os.WriteFile(configPath, []byte(req.Config), 0o644); err != nil {
		return nil, fmt.Errorf("write realm config: %w", err)
	}

	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return nil, fmt.Errorf("open log file: %w", err)
	}

	cmd := exec.Command("realm", "-c", configPath)
	cmd.Stdout = logFile
	cmd.Stderr = logFile

	if err := setupIptablesRules(req.RuleID, req.Port, req.Protocol); err != nil {
		log.Printf("setup iptables failed but continue: %v", err)
	}

	if err := cmd.Start(); err != nil {
		cleanupIptablesRules(req.RuleID, req.Port, req.Protocol)
		_ = logFile.Close()
		return nil, fmt.Errorf("start realm: %w", err)
	}

	proc := &RealmProcess{
		RuleID:     req.RuleID,
		NodeID:     req.NodeID,
		Cmd:        cmd,
		ConfigPath: configPath,
		LogPath:    logPath,
		StartTime:  time.Now(),
		WaitDone:   make(chan struct{}),
		logFile:    logFile,
		stopStats:  make(chan struct{}),
		statsIntv:  statsDuration(req.StatsInterval),
		port:       req.Port,
		protocol:   req.Protocol,
		startReq:   req,
		conn:       conn,
		crashLimit: crashLimit(req.CrashRestartLimit),
	}
	if req.EntryNodeID != "" && req.NodeID == req.EntryNodeID && (req.HealthCheckNextHop != "" || req.HealthCheckTarget != "") {
		proc.linkMonitor = NewLinkHealthMonitor(req.Protocol, req.HealthCheckNextHop, req.HealthCheckTarget, req.HealthCheckInterval)
		proc.linkMonitor.Start()
	}

	m.mu.Lock()
	m.processes[key] = proc
	m.mu.Unlock()

	go m.waitForExit(key, proc)
	if conn != nil {
		go m.startStatsLoop(conn, proc, req.RuleID, req.NodeID)
	}
	return proc, nil
}

func (m *ProcessManager) waitForExit(key string, proc *RealmProcess) {
	err := proc.Cmd.Wait()
	if proc.logFile != nil {
		_ = proc.logFile.Close()
	}
	if proc.stopStats != nil {
		close(proc.stopStats)
		proc.stopStats = nil
	}
	if proc.collector != nil {
		proc.collector.Stop()
		proc.collector = nil
	}
	if proc.linkMonitor != nil {
		proc.linkMonitor.Stop()
		proc.linkMonitor = nil
	}

	if err != nil && !proc.stopping && proc.crashLimit > 0 && proc.crashCount < proc.crashLimit {
		proc.crashCount++
		log.Printf("realm process %s crashed (%d/%d), restarting...", key, proc.crashCount, proc.crashLimit)
		time.Sleep(5 * time.Second)
		m.mu.Lock()
		delete(m.processes, key)
		m.mu.Unlock()
		close(proc.WaitDone)
		if _, restartErr := m.Start(proc.startReq, proc.conn); restartErr == nil {
			return
		}
	}

	if err != nil {
		log.Printf("realm process %s exited with error: %v", key, err)
	}
	cleanupIptablesRules(proc.RuleID, proc.port, proc.protocol)

	m.mu.Lock()
	delete(m.processes, key)
	m.mu.Unlock()
	close(proc.WaitDone)
}

func (m *ProcessManager) Stop(ruleID uint, nodeID string, timeout time.Duration) error {
	key := m.key(ruleID, nodeID)

	m.mu.Lock()
	proc, ok := m.processes[key]
	m.mu.Unlock()
	if !ok {
		return nil
	}
	if proc.Cmd.Process == nil {
		return fmt.Errorf("realm process not running")
	}
	proc.stopping = true

	if proc.stopStats != nil {
		close(proc.stopStats)
		proc.stopStats = nil
	}
	if proc.collector != nil {
		proc.collector.Stop()
	}
	if proc.linkMonitor != nil {
		proc.linkMonitor.Stop()
		proc.linkMonitor = nil
	}
	_ = proc.Cmd.Process.Signal(syscall.SIGTERM)

	select {
	case <-proc.WaitDone:
	case <-time.After(timeout):
		_ = proc.Cmd.Process.Kill()
		<-proc.WaitDone
	}
	return nil
}

func (m *ProcessManager) Update(req UpdateRealmRequest, conn *ws.SafeConn) (*RealmProcess, error) {
	timeout := stopDuration(req.StopTimeout)
	if err := m.Stop(req.RuleID, req.NodeID, timeout); err != nil {
		return nil, err
	}
	return m.Start(StartRealmRequest{
		RuleID:        req.RuleID,
		NodeID:        req.NodeID,
		Protocol:      req.Protocol,
		Config:        req.NewConfig,
		Port:          req.NewPort,
		StatsInterval: req.StatsInterval,
		HealthCheckInterval: req.HealthCheckInterval,
		HealthCheckNextHop:  req.HealthCheckNextHop,
		HealthCheckTarget:   req.HealthCheckTarget,
		CrashRestartLimit: req.CrashRestartLimit,
		StopTimeout:       req.StopTimeout,
	}, conn)
}

func (m *ProcessManager) key(ruleID uint, nodeID string) string {
	return fmt.Sprintf("rule-%d-node-%s", ruleID, nodeID)
}

func (m *ProcessManager) startStatsLoop(conn *ws.SafeConn, proc *RealmProcess, ruleID uint, nodeID string) {
	if conn == nil || proc == nil {
		return
	}
	collector := NewStatsCollector(m.health, int(proc.statsIntv/time.Second))
	proc.collector = collector
	collector.linkMonitor = proc.linkMonitor
	collector.StartLoop(conn, ruleID, nodeID, proc.port, proc.protocol)
}

func crashLimit(val int) int {
	if val <= 0 {
		return 3
	}
	return val
}

func stopDuration(val int) time.Duration {
	if val <= 0 {
		return 5 * time.Second
	}
	return time.Duration(val) * time.Second
}
