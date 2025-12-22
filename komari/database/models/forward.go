package models

// ForwardRule 转发规则配置表
type ForwardRule struct {
	ID               uint      `json:"id" gorm:"primaryKey;autoIncrement"`
	IsEnabled        bool      `json:"is_enabled" gorm:"default:true"`
	Name             string    `json:"name" gorm:"type:varchar(255);index"`
	GroupName        string    `json:"group_name" gorm:"type:varchar(255);index"`
	SortOrder        int       `json:"sort_order" gorm:"default:0"`
	Tags             string    `json:"tags" gorm:"type:longtext"`                              // JSON 数组字符串
	Notes            string    `json:"notes" gorm:"type:longtext"`                             // 备注
	Type             string    `json:"type" gorm:"type:varchar(32);index"`                     // direct / relay_group / chain
	Status           string    `json:"status" gorm:"type:varchar(32);index;default:'stopped'"` // stopped / running / error
	ConfigJSON       string    `json:"config_json" gorm:"type:longtext"`                       // 结构化配置（JSON）
	RealmConfig      string    `json:"realm_config" gorm:"type:longtext"`                      // 最新下发的入口 Realm 配置（TOML）
	TotalConnections int64     `json:"total_connections" gorm:"type:bigint;default:0"`
	TotalTrafficIn   int64     `json:"total_traffic_in" gorm:"type:bigint;default:0"`
	TotalTrafficOut  int64     `json:"total_traffic_out" gorm:"type:bigint;default:0"`
	CreatedAt        LocalTime `json:"created_at"`
	UpdatedAt        LocalTime `json:"updated_at"`
}

// ForwardStat 实时状态与统计
type ForwardStat struct {
	ID                uint      `json:"id" gorm:"primaryKey;autoIncrement"`
	RuleID            uint      `json:"rule_id" gorm:"uniqueIndex:idx_rule_node,priority:1"`
	NodeID            string    `json:"node_id" gorm:"type:varchar(36);uniqueIndex:idx_rule_node,priority:2"`
	LinkStatus        string    `json:"link_status" gorm:"type:varchar(20);default:'healthy'"` // healthy / degraded / faulty
	ActiveConnections int       `json:"active_connections" gorm:"type:int"`
	TrafficInBytes    int64     `json:"traffic_in_bytes" gorm:"type:bigint"`
	TrafficOutBytes   int64     `json:"traffic_out_bytes" gorm:"type:bigint"`
	RealtimeBpsIn     int64     `json:"realtime_bps_in" gorm:"type:bigint"`
	RealtimeBpsOut    int64     `json:"realtime_bps_out" gorm:"type:bigint"`
	ActiveRelayNodeID string    `json:"active_relay_node_id" gorm:"type:varchar(36)"`
	NodesLatency      string    `json:"nodes_latency" gorm:"type:longtext"` // JSON map: node_uuid -> latency(ms)
	LastUpdatedAt     LocalTime `json:"last_updated_at" gorm:"type:timestamp"`
}

// ForwardTrafficHistory 流量历史数据
type ForwardTrafficHistory struct {
	ID              uint      `json:"id" gorm:"primaryKey;autoIncrement"`
	RuleID          uint      `json:"rule_id" gorm:"index:idx_rule_timestamp,priority:1"`
	NodeID          string    `json:"node_id" gorm:"type:varchar(36);index:idx_node_timestamp,priority:1"`
	Timestamp       LocalTime `json:"timestamp" gorm:"index:idx_rule_timestamp,priority:2;index:idx_node_timestamp,priority:2"`
	Connections     int       `json:"connections" gorm:"type:int"`
	TrafficInBytes  int64     `json:"traffic_in_bytes" gorm:"type:bigint"`
	TrafficOutBytes int64     `json:"traffic_out_bytes" gorm:"type:bigint"`
	AvgLatencyMs    int       `json:"avg_latency_ms" gorm:"type:int"`
}

// ForwardAlertConfig 告警配置表（单规则）
type ForwardAlertConfig struct {
	ID                    uint      `json:"id" gorm:"primaryKey;autoIncrement"`
	RuleID                uint      `json:"rule_id" gorm:"uniqueIndex"`
	Enabled               bool      `json:"enabled" gorm:"default:false"`
	NodeDownEnabled       bool      `json:"node_down_enabled" gorm:"default:true"`
	LinkDegradedEnabled   bool      `json:"link_degraded_enabled" gorm:"default:true"`
	LinkFaultyEnabled     bool      `json:"link_faulty_enabled" gorm:"default:true"`
	HighLatencyEnabled    bool      `json:"high_latency_enabled" gorm:"default:false"`
	HighLatencyThreshold  int       `json:"high_latency_threshold" gorm:"default:200"` // ms
	TrafficSpikeEnabled   bool      `json:"traffic_spike_enabled" gorm:"default:false"`
	TrafficSpikeThreshold float64   `json:"traffic_spike_threshold" gorm:"type:decimal(10,2);default:2.00"`
	CreatedAt             LocalTime `json:"created_at"`
	UpdatedAt             LocalTime `json:"updated_at"`
}

// ForwardAlertHistory 告警历史记录
type ForwardAlertHistory struct {
	ID             uint       `json:"id" gorm:"primaryKey;autoIncrement"`
	RuleID         uint       `json:"rule_id" gorm:"index"`
	AlertType      string     `json:"alert_type" gorm:"type:varchar(32);index"` // node_down / link_degraded / link_faulty / high_latency / traffic_spike
	Severity       string     `json:"severity" gorm:"type:varchar(16);index"`   // info / warning / critical
	Message        string     `json:"message" gorm:"type:longtext"`
	Details        string     `json:"details" gorm:"type:longtext"` // JSON 详情
	Acknowledged   bool       `json:"acknowledged" gorm:"default:false"`
	AcknowledgedAt *LocalTime `json:"acknowledged_at" gorm:"type:timestamp"`
	AcknowledgedBy string     `json:"acknowledged_by" gorm:"type:varchar(100)"`
	CreatedAt      LocalTime  `json:"created_at"`
}

// RealmBinary Realm 二进制文件管理
type RealmBinary struct {
	ID         uint      `json:"id" gorm:"primaryKey;autoIncrement"`
	OS         string    `json:"os" gorm:"type:varchar(32);uniqueIndex:idx_os_arch_version,priority:1"`
	Arch       string    `json:"arch" gorm:"type:varchar(32);uniqueIndex:idx_os_arch_version,priority:2"`
	Version    string    `json:"version" gorm:"type:varchar(64);uniqueIndex:idx_os_arch_version,priority:3"`
	FilePath   string    `json:"file_path" gorm:"type:varchar(512)"`
	FileSize   int64     `json:"file_size" gorm:"type:bigint"`
	FileHash   string    `json:"file_hash" gorm:"type:varchar(128)"`
	IsDefault  bool      `json:"is_default" gorm:"default:false"`
	UploadedAt LocalTime `json:"uploaded_at" gorm:"type:timestamp"`
	CreatedAt  LocalTime `json:"created_at"`
	UpdatedAt  LocalTime `json:"updated_at"`
}

// ForwardSystemSettings 系统参数配置（单行表，id=1）
type ForwardSystemSettings struct {
	ID                     uint      `json:"id" gorm:"primaryKey;autoIncrement"`
	StatsReportInterval    int       `json:"stats_report_interval" gorm:"default:30"` // 秒
	HealthCheckInterval    int       `json:"health_check_interval" gorm:"default:60"` // 秒
	HistoryAggregatePeriod string    `json:"history_aggregate_period" gorm:"type:varchar(20);default:'1hour'"`
	RealmCrashRestartLimit int       `json:"realm_crash_restart_limit" gorm:"default:3"`
	ProcessStopTimeout     int       `json:"process_stop_timeout" gorm:"default:5"` // 秒
	UpdatedAt              LocalTime `json:"updated_at"`
	CreatedAt              LocalTime `json:"created_at"`
}

// RealmConfigTemplate Realm 默认配置模板（单行表，id=1）
type RealmConfigTemplate struct {
	ID           uint      `json:"id" gorm:"primaryKey;autoIncrement"`
	TemplateToml string    `json:"template_toml" gorm:"type:longtext"`
	UpdatedAt    LocalTime `json:"updated_at"`
	CreatedAt    LocalTime `json:"created_at"`
}
