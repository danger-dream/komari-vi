package forward

import "encoding/json"

// TaskType 统一的转发任务类型
type TaskType string

const (
	TaskCheckPort         TaskType = "CHECK_PORT"
	TaskPrepareForwardEnv          = "PREPARE_FORWARD_ENV"
	TaskStartRealm                 = "START_REALM"
	TaskStopRealm                  = "STOP_REALM"
	TaskUpdateRealm                = "UPDATE_REALM"
	TaskGetRealmLog                = "GET_REALM_LOG"
	TaskClearRealmLog              = "CLEAR_REALM_LOG"
	TaskDeleteRealmLog             = "DELETE_REALM_LOG"
	TaskTestConnectivity           = "TEST_CONNECTIVITY"
)

// TaskEnvelope 任务封装，便于 WS / HTTP 传输
type TaskEnvelope struct {
	TaskID   string          `json:"task_id"`
	TaskType TaskType        `json:"task_type"`
	Payload  json.RawMessage `json:"payload"`
}

type CheckPortRequest struct {
	PortSpec      string `json:"port_spec"`
	ExcludedPorts []int  `json:"excluded_ports,omitempty"`
}

type CheckPortResponse struct {
	Success       bool   `json:"success"`
	AvailablePort *int   `json:"available_port,omitempty"`
	Message       string `json:"message"`
}

type PrepareForwardEnvRequest struct {
	RealmDownloadURL string `json:"realm_download_url"`
	ForceReinstall   bool   `json:"force_reinstall"`
}

type PrepareForwardEnvResponse struct {
	Success      bool   `json:"success"`
	FirewallTool string `json:"firewall_tool,omitempty"`
	RealmVersion string `json:"realm_version,omitempty"`
	Message      string `json:"message"`
}

type StartRealmRequest struct {
	RuleID             uint              `json:"rule_id"`
	NodeID             string            `json:"node_id"`
	EntryNodeID        string            `json:"entry_node_id"`
	Protocol           string            `json:"protocol"`
	Config             string            `json:"config"`
	Port               int               `json:"port"`
	StatsInterval      int               `json:"stats_interval"`
	HealthCheckInterval int              `json:"health_check_interval,omitempty"`
	HealthCheckNextHop  string           `json:"health_check_next_hop,omitempty"`
	HealthCheckTarget   string           `json:"health_check_target,omitempty"`
	CrashRestartLimit  int               `json:"crash_restart_limit,omitempty"`
	StopTimeout        int               `json:"stop_timeout,omitempty"`
	PriorityConfigs    map[string]string `json:"priority_configs,omitempty"`
	PriorityRelays     []RelayNode       `json:"priority_relays,omitempty"`
	ActiveRelayNodeID  string            `json:"active_relay_node_id,omitempty"`
	PriorityListenPort int               `json:"priority_listen_port,omitempty"`
}

type StartRealmResponse struct {
	Success    bool   `json:"success"`
	Pid        int    `json:"pid,omitempty"`
	ConfigPath string `json:"config_path,omitempty"`
	LogPath    string `json:"log_path,omitempty"`
	Message    string `json:"message"`
}

type StopRealmRequest struct {
	RuleID uint   `json:"rule_id"`
	NodeID string `json:"node_id"`
	Protocol string `json:"protocol"`
	Port   int    `json:"port"`
	Timeout int   `json:"timeout,omitempty"`
}

type StopRealmResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
}

type UpdateRealmRequest struct {
	RuleID             uint              `json:"rule_id"`
	NodeID             string            `json:"node_id"`
	Protocol           string            `json:"protocol"`
	NewConfig          string            `json:"new_config"`
	NewPort            int               `json:"new_port"`
	StatsInterval      int               `json:"stats_interval"`
	HealthCheckInterval int              `json:"health_check_interval,omitempty"`
	HealthCheckNextHop  string           `json:"health_check_next_hop,omitempty"`
	HealthCheckTarget   string           `json:"health_check_target,omitempty"`
	CrashRestartLimit  int               `json:"crash_restart_limit,omitempty"`
	StopTimeout        int               `json:"stop_timeout,omitempty"`
	EntryNodeID        string            `json:"entry_node_id,omitempty"`
	PriorityConfigs    map[string]string `json:"priority_configs,omitempty"`
	PriorityRelays     []RelayNode       `json:"priority_relays,omitempty"`
	ActiveRelayNodeID  string            `json:"active_relay_node_id,omitempty"`
	PriorityListenPort int               `json:"priority_listen_port,omitempty"`
}

type UpdateRealmResponse struct {
	Success bool   `json:"success"`
	Pid     int    `json:"pid,omitempty"`
	Message string `json:"message"`
}

type GetRealmLogRequest struct {
	RuleID uint   `json:"rule_id"`
	NodeID string `json:"node_id"`
	Lines  int    `json:"lines"`
}

type GetRealmLogResponse struct {
	Success       bool   `json:"success"`
	LogContent    string `json:"log_content,omitempty"`
	LinesReturned int    `json:"lines_returned,omitempty"`
	Message       string `json:"message"`
}

type ClearRealmLogRequest struct {
	RuleID uint   `json:"rule_id"`
	NodeID string `json:"node_id"`
}

type ClearRealmLogResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
}

type DeleteRealmLogRequest struct {
	RuleID uint   `json:"rule_id"`
	NodeID string `json:"node_id"`
}

type DeleteRealmLogResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
}

type TestConnectivityRequest struct {
	TargetHost string `json:"target_host"`
	TargetPort int    `json:"target_port"`
	Timeout    int    `json:"timeout"`
}

type TestConnectivityResponse struct {
	Success   bool   `json:"success"`
	Reachable bool   `json:"reachable"`
	LatencyMs *int64 `json:"latency_ms,omitempty"`
	Message   string `json:"message"`
}
