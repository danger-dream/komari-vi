package models

import (
	"database/sql/driver"
	"encoding/json"
	"fmt"
)

type UIntArray []uint

func (ua *UIntArray) Scan(value interface{}) error {
	bytes, ok := value.([]byte)
	if !ok {
		return fmt.Errorf("failed to scan UIntArray: value is not []byte")
	}
	return json.Unmarshal(bytes, ua)
}

func (ua UIntArray) Value() (driver.Value, error) {
	return json.Marshal(ua)
}

type ScriptClientStatus struct {
	ClientID       string    `json:"client_id"`
	ExecID         string    `json:"exec_id,omitempty"`
	DispatchStatus string    `json:"dispatch_status,omitempty"`
	ExecStatus     string    `json:"exec_status,omitempty"`
	ErrorLog       string    `json:"error_log,omitempty"`
	UpdatedAt      LocalTime `json:"updated_at"`
}

type ScriptClientStatusList []ScriptClientStatus

func (s *ScriptClientStatusList) Scan(value interface{}) error {
	bytes, ok := value.([]byte)
	if !ok {
		return fmt.Errorf("failed to scan ScriptClientStatusList: value is not []byte")
	}
	return json.Unmarshal(bytes, s)
}

func (s ScriptClientStatusList) Value() (driver.Value, error) {
	return json.Marshal(s)
}

type ScriptFolder struct {
	ID        uint      `json:"id" gorm:"primaryKey"`
	Name      string    `json:"name" gorm:"type:varchar(255)"`
	ParentID  *uint     `json:"parent_id" gorm:"index"`
	Icon      string    `json:"icon" gorm:"type:varchar(64)"`
	Order     int       `json:"order"`
	CreatedAt LocalTime `json:"created_at"`
	UpdatedAt LocalTime `json:"updated_at"`
}

type Script struct {
	ID               uint                   `json:"id" gorm:"primaryKey"`
	FolderID         *uint                  `json:"folder_id" gorm:"index"`
	Order            int                    `json:"order"`
	Name             string                 `json:"name" gorm:"type:varchar(255)"`
	Enabled          bool                   `json:"enabled"`
	Clients          StringArray            `json:"clients" gorm:"type:longtext"`
	ClientStatus     ScriptClientStatusList `json:"client_status" gorm:"type:longtext"`
	ScriptBody       string                 `json:"script_body" gorm:"type:longtext"`
	TimeoutSec       int                    `json:"timeout_sec"`
	TriggerKind      string                 `json:"trigger_kind" gorm:"type:varchar(32)"`
	CronExpr         string                 `json:"cron_expr" gorm:"type:varchar(255)"`
	TriggerName      string                 `json:"trigger_name" gorm:"type:varchar(128)"`
	MessageType      string                 `json:"message_type" gorm:"type:varchar(64)"`
	DependsOnScripts UIntArray              `json:"depends_on_scripts" gorm:"type:longtext"`
	DependsOnFolders UIntArray              `json:"depends_on_folders" gorm:"type:longtext"`
	CreatedAt        LocalTime              `json:"created_at"`
	UpdatedAt        LocalTime              `json:"updated_at"`
}

type ScriptLogEntry struct {
	Time    LocalTime `json:"time"`
	Type    string    `json:"type"`
	Content string    `json:"content"`
}

type ScriptLogEntries []ScriptLogEntry

func (s *ScriptLogEntries) Scan(value interface{}) error {
	bytes, ok := value.([]byte)
	if !ok {
		return fmt.Errorf("failed to scan ScriptLogEntries: value is not []byte")
	}
	return json.Unmarshal(bytes, s)
}

func (s ScriptLogEntries) Value() (driver.Value, error) {
	return json.Marshal(s)
}

type ScriptExecutionHistory struct {
	ID          uint             `json:"id" gorm:"primaryKey"`
	ScriptID    uint             `json:"script_id" gorm:"index"`
	ExecID      string           `json:"exec_id" gorm:"type:varchar(64);index"`
	ClientUUID  string           `json:"client_uuid" gorm:"type:varchar(36);index"`
	Status      string           `json:"status" gorm:"type:varchar(20)"`
	TriggerKind string           `json:"trigger_kind" gorm:"type:varchar(32)"`
	TriggerName string           `json:"trigger_name" gorm:"type:varchar(128)"`
	StartedAt   LocalTime        `json:"started_at"`
	FinishedAt  LocalTime        `json:"finished_at"`
	DurationMs  int64            `json:"duration_ms"`
	Output      ScriptLogEntries `json:"output" gorm:"type:longtext"`
	ErrorLog    string           `json:"error_log" gorm:"type:longtext"`
	CreatedAt   LocalTime        `json:"created_at"`
	UpdatedAt   LocalTime        `json:"updated_at"`
}

type ScriptVariable struct {
	ID              uint      `json:"id" gorm:"primaryKey"`
	Scope           string    `json:"scope" gorm:"type:varchar(16);index"`
	ScriptID        *uint     `json:"script_id" gorm:"index"`
	ClientUUID      *string   `json:"client_uuid" gorm:"type:varchar(36);index"`
	Key             string    `json:"key" gorm:"type:varchar(255);index:idx_script_var_key"`
	Value           string    `json:"value" gorm:"type:longtext"`
	ValueType       string    `json:"value_type" gorm:"type:varchar(20)"`
	CreatedByClient string    `json:"created_by_client" gorm:"type:varchar(64)"`
	UpdatedByClient string    `json:"updated_by_client" gorm:"type:varchar(64)"`
	CreatedAt       LocalTime `json:"created_at"`
	UpdatedAt       LocalTime `json:"updated_at"`
}
