package forward

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/komari-monitor/komari-agent/ws"
)

type Manager struct {
	process  *ProcessManager
	firewall *FirewallManager
	health   *HealthChecker
	switcher *PrioritySwitcher
}

func NewManager() *Manager {
	health := NewHealthChecker()
	process := NewProcessManager(health)
	return &Manager{
		process:  process,
		firewall: NewFirewallManager(),
		health:   health,
		switcher: NewPrioritySwitcher(health, process),
	}
}

func (m *Manager) HandleTask(conn *ws.SafeConn, env TaskEnvelope) (interface{}, error) {
	switch env.TaskType {
	case TaskCheckPort:
		var req CheckPortRequest
		if err := json.Unmarshal(env.Payload, &req); err != nil {
			return nil, err
		}
		return m.handleCheckPort(req), nil
	case TaskPrepareForwardEnv:
		var req PrepareForwardEnvRequest
		if err := json.Unmarshal(env.Payload, &req); err != nil {
			return nil, err
		}
		return m.handlePrepareEnv(req), nil
	case TaskStartRealm:
		var req StartRealmRequest
		if err := json.Unmarshal(env.Payload, &req); err != nil {
			return nil, err
		}
		return m.handleStartRealm(conn, req), nil
	case TaskStopRealm:
		var req StopRealmRequest
		if err := json.Unmarshal(env.Payload, &req); err != nil {
			return nil, err
		}
		return m.handleStopRealm(req), nil
	case TaskUpdateRealm:
		var req UpdateRealmRequest
		if err := json.Unmarshal(env.Payload, &req); err != nil {
			return nil, err
		}
		return m.handleUpdateRealm(conn, req), nil
	case TaskGetRealmLog:
		var req GetRealmLogRequest
		if err := json.Unmarshal(env.Payload, &req); err != nil {
			return nil, err
		}
		return m.handleGetRealmLog(req), nil
	case TaskClearRealmLog:
		var req ClearRealmLogRequest
		if err := json.Unmarshal(env.Payload, &req); err != nil {
			return nil, err
		}
		return m.handleClearRealmLog(req), nil
	case TaskDeleteRealmLog:
		var req DeleteRealmLogRequest
		if err := json.Unmarshal(env.Payload, &req); err != nil {
			return nil, err
		}
		return m.handleDeleteRealmLog(req), nil
	case TaskTestConnectivity:
		var req TestConnectivityRequest
		if err := json.Unmarshal(env.Payload, &req); err != nil {
			return nil, err
		}
		return m.handleTestConnectivity(req), nil
	default:
		return nil, fmt.Errorf("unknown forward task type: %s", env.TaskType)
	}
}

func (m *Manager) handleCheckPort(req CheckPortRequest) CheckPortResponse {
	port, err := findAvailablePort(req.PortSpec, req.ExcludedPorts)
	if err != nil {
		return CheckPortResponse{Success: false, Message: err.Error()}
	}
	return CheckPortResponse{
		Success:       true,
		AvailablePort: &port,
		Message:       fmt.Sprintf("Port %d is available", port),
	}
}

func (m *Manager) handlePrepareEnv(req PrepareForwardEnvRequest) PrepareForwardEnvResponse {
	tool := m.firewall.Detect()

	realmPath, version, err := ensureRealmBinary(req.RealmDownloadURL, req.ForceReinstall)
	if err != nil {
		return PrepareForwardEnvResponse{
			Success:      false,
			FirewallTool: string(tool),
			Message:      err.Error(),
		}
	}
	if err := os.MkdirAll(realmConfigDir, 0o755); err != nil {
		return PrepareForwardEnvResponse{
			Success:      false,
			FirewallTool: string(tool),
			Message:      fmt.Sprintf("prepare config dir: %v", err),
		}
	}
	if err := os.MkdirAll(realmLogDir, 0o755); err != nil {
		return PrepareForwardEnvResponse{
			Success:      false,
			FirewallTool: string(tool),
			Message:      fmt.Sprintf("prepare log dir: %v", err),
		}
	}
	return PrepareForwardEnvResponse{
		Success:      true,
		FirewallTool: string(tool),
		RealmVersion: version,
		Message:      fmt.Sprintf("realm ready at %s", realmPath),
	}
}

func (m *Manager) handleStartRealm(conn *ws.SafeConn, req StartRealmRequest) StartRealmResponse {
	// 防火墙放行
	if err := openPortByProtocol(m.firewall, req.Port, req.Protocol); err != nil {
		return StartRealmResponse{Success: false, Message: fmt.Sprintf("open port failed: %v", err)}
	}

	proc, err := m.process.Start(req, conn)
	if err != nil {
		return StartRealmResponse{Success: false, Message: err.Error()}
	}
	sendForwardStats(conn, req.RuleID, req.NodeID, req.Port, "healthy", 0, 0, 0, 0, 0, 0)
	m.health.RecordStatus(req.RuleID, req.NodeID, true, 0)

	// priority 策略：仅入口节点需要监控切换
	if req.EntryNodeID != "" && req.NodeID == req.EntryNodeID && len(req.PriorityConfigs) > 0 && len(req.PriorityRelays) > 0 {
		go m.switcher.MonitorAndSwitch(conn, req.RuleID, req.EntryNodeID, req.PriorityRelays, req.PriorityConfigs, req.ActiveRelayNodeID, req.Port, time.Duration(req.StatsInterval)*time.Second, req.Protocol, req.HealthCheckInterval, req.HealthCheckTarget)
	}
	return StartRealmResponse{
		Success:    true,
		Pid:        proc.Cmd.Process.Pid,
		ConfigPath: proc.ConfigPath,
		LogPath:    proc.LogPath,
		Message:    "Realm process started successfully",
	}
}

func (m *Manager) handleStopRealm(req StopRealmRequest) StopRealmResponse {
	if m.switcher != nil {
		m.switcher.Stop(req.RuleID)
	}
	timeout := 5 * time.Second
	if req.Timeout > 0 {
		timeout = time.Duration(req.Timeout) * time.Second
	}
	if err := m.process.Stop(req.RuleID, req.NodeID, timeout); err != nil {
		return StopRealmResponse{Success: false, Message: err.Error()}
	}
	// 关闭放行
	if req.Port > 0 {
		_ = closePortByProtocol(m.firewall, req.Port, req.Protocol)
	}
	return StopRealmResponse{Success: true, Message: "Realm process stopped successfully"}
}

func (m *Manager) handleUpdateRealm(conn *ws.SafeConn, req UpdateRealmRequest) UpdateRealmResponse {
	proc, err := m.process.Update(req, conn)
	if err != nil {
		return UpdateRealmResponse{Success: false, Message: err.Error()}
	}
	sendForwardStats(conn, req.RuleID, req.NodeID, req.NewPort, "healthy", 0, 0, 0, 0, 0, 0)
	m.health.RecordStatus(req.RuleID, req.NodeID, true, 0)
	if req.EntryNodeID != "" && req.NodeID == req.EntryNodeID && len(req.PriorityConfigs) > 0 && len(req.PriorityRelays) > 0 {
		if m.switcher != nil {
			m.switcher.Stop(req.RuleID)
			go m.switcher.MonitorAndSwitch(conn, req.RuleID, req.EntryNodeID, req.PriorityRelays, req.PriorityConfigs, req.ActiveRelayNodeID, req.NewPort, time.Duration(req.StatsInterval)*time.Second, req.Protocol, req.HealthCheckInterval, req.HealthCheckTarget)
		}
	}
	return UpdateRealmResponse{
		Success: true,
		Pid:     proc.Cmd.Process.Pid,
		Message: "Realm process updated successfully",
	}
}

func (m *Manager) handleGetRealmLog(req GetRealmLogRequest) GetRealmLogResponse {
	if req.Lines <= 0 {
		req.Lines = 100
	}
	_, logPath := buildPaths(req.RuleID, req.NodeID)
	content, err := readLastLines(logPath, req.Lines)
	if err != nil {
		return GetRealmLogResponse{Success: false, Message: err.Error()}
	}
	return GetRealmLogResponse{
		Success:       true,
		LogContent:    content,
		LinesReturned: req.Lines,
	}
}

func (m *Manager) handleClearRealmLog(req ClearRealmLogRequest) ClearRealmLogResponse {
	_, logPath := buildPaths(req.RuleID, req.NodeID)
	if err := os.Truncate(logPath, 0); err != nil {
		return ClearRealmLogResponse{Success: false, Message: err.Error()}
	}
	return ClearRealmLogResponse{Success: true, Message: "Log file cleared successfully"}
}

func (m *Manager) handleDeleteRealmLog(req DeleteRealmLogRequest) DeleteRealmLogResponse {
	_, logPath := buildPaths(req.RuleID, req.NodeID)
	matches, _ := filepath.Glob(logPath + "*")
	if len(matches) == 0 {
		return DeleteRealmLogResponse{Success: true, Message: "No log file to delete"}
	}
	for _, file := range matches {
		if err := os.Remove(file); err != nil && !errors.Is(err, os.ErrNotExist) {
			return DeleteRealmLogResponse{Success: false, Message: err.Error()}
		}
	}
	return DeleteRealmLogResponse{Success: true, Message: "Log file deleted successfully"}
}

func (m *Manager) handleTestConnectivity(req TestConnectivityRequest) TestConnectivityResponse {
	address := net.JoinHostPort(req.TargetHost, strconv.Itoa(req.TargetPort))
	timeout := time.Duration(req.Timeout) * time.Second
	start := time.Now()
	conn, err := net.DialTimeout("tcp", address, timeout)
	if err != nil {
		return TestConnectivityResponse{
			Success:   false,
			Reachable: false,
			Message:   err.Error(),
		}
	}
	_ = conn.Close()
	latency := time.Since(start).Milliseconds()
	return TestConnectivityResponse{
		Success:   true,
		Reachable: true,
		LatencyMs: &latency,
		Message:   "Target is reachable",
	}
}

func openPortByProtocol(firewall *FirewallManager, port int, protocol string) error {
	for _, proto := range normalizeProtocols(protocol) {
		if err := firewall.OpenPort(port, proto); err != nil {
			return err
		}
	}
	return nil
}

func closePortByProtocol(firewall *FirewallManager, port int, protocol string) error {
	for _, proto := range normalizeProtocols(protocol) {
		if err := firewall.ClosePort(port, proto); err != nil {
			return err
		}
	}
	return nil
}

func ensureRealmBinary(downloadURL string, force bool) (string, string, error) {
	candidates := []string{"/usr/local/bin/realm", "/usr/bin/realm"}

	if !force {
		for _, p := range candidates {
			if fileExists(p) {
				version := getRealmVersion(p)
				return p, version, nil
			}
		}
		if path, err := exec.LookPath("realm"); err == nil {
			version := getRealmVersion(path)
			return path, version, nil
		}
	}

	if downloadURL == "" {
		return "", "", fmt.Errorf("realm binary not found and no download url provided")
	}

	target := candidates[0]
	if err := downloadTo(downloadURL, target); err != nil {
		return "", "", err
	}
	if err := os.Chmod(target, 0o755); err != nil {
		return "", "", err
	}
	version := getRealmVersion(target)
	return target, version, nil
}

func downloadTo(url, target string) error {
	resp, err := http.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download realm failed: %s", resp.Status)
	}
	tmpPath := target + ".tmp"
	tmpFile, err := os.Create(tmpPath)
	if err != nil {
		return err
	}
	defer tmpFile.Close()

	if _, err := io.Copy(tmpFile, resp.Body); err != nil {
		return err
	}
	return os.Rename(tmpPath, target)
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func getRealmVersion(path string) string {
	out, err := exec.Command(path, "--version").CombinedOutput()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func readLastLines(path string, n int) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()

	lines := make([]string, 0, n)
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		lines = append(lines, scanner.Text())
		if len(lines) > n {
			lines = lines[1:]
		}
	}
	if err := scanner.Err(); err != nil {
		return "", err
	}
	return strings.Join(lines, "\n"), nil
}
