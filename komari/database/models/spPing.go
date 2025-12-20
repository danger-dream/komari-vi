package models

// SPPingTask 描述 SmokePing 风格的延迟任务
type SPPingTask struct {
	Id          uint        `json:"id,omitempty" gorm:"primaryKey;autoIncrement"`
	Name        string      `json:"name" gorm:"type:varchar(255);not null;index"`
	Clients     StringArray `json:"clients" gorm:"type:longtext"`
	Type        string      `json:"type" gorm:"type:varchar(12);not null;default:'icmp'"` // icmp tcp http
	Target      string      `json:"target" gorm:"type:varchar(255);not null"`
	Step        int         `json:"step" gorm:"type:int;not null;default:300"`        // 探测间隔（秒），与 SmokePing step 含义相同
	Pings       int         `json:"pings" gorm:"type:int;not null;default:20"`        // 每轮发送包数量
	TimeoutMS   int         `json:"timeout_ms" gorm:"type:int;not null;default:1000"` // 每轮总超时（毫秒）
	PayloadSize int         `json:"payload_size" gorm:"type:int;not null;default:56"` // ICMP/UDP 载荷尺寸
	Weight      int         `json:"weight" gorm:"type:int;default:0;index"`           // 排序权重，越小越靠前
	CreatedAt   LocalTime   `json:"created_at"`
	UpdatedAt   LocalTime   `json:"updated_at"`
}

// SPPingRecord 存储一轮或聚合后的延迟分布
type SPPingRecord struct {
	Id         uint       `json:"id,omitempty" gorm:"primaryKey;autoIncrement"`
	TaskId     uint       `json:"task_id" gorm:"not null;uniqueIndex:idx_sp_task_client_time_bucket,priority:1"`
	Task       SPPingTask `json:"task" gorm:"foreignKey:TaskId;references:Id;constraint:OnDelete:CASCADE,OnUpdate:CASCADE;"`
	Client     string     `json:"client" gorm:"type:varchar(36);not null;uniqueIndex:idx_sp_task_client_time_bucket,priority:2"`
	ClientInfo Client     `json:"client_info" gorm:"foreignKey:Client;references:UUID;constraint:OnDelete:CASCADE,OnUpdate:CASCADE"`
	Time       LocalTime  `json:"time" gorm:"index;not null;uniqueIndex:idx_sp_task_client_time_bucket,priority:3"`
	BucketStep int        `json:"bucket_step" gorm:"type:int;not null;uniqueIndex:idx_sp_task_client_time_bucket,priority:4"` // 当前记录代表的步长（step, step*12, step*144...）
	Step       int        `json:"step" gorm:"type:int;not null"`                                                              // 原始任务 step
	Pings      int        `json:"pings" gorm:"type:int;not null"`                                                             // 原始任务 pings
	Median     float64    `json:"median" gorm:"type:double;not null;default:-1"`
	Min        float64    `json:"min" gorm:"type:double;not null;default:-1"`
	Max        float64    `json:"max" gorm:"type:double;not null;default:-1"`
	P10        float64    `json:"p10" gorm:"type:double;not null;default:-1"`
	P90        float64    `json:"p90" gorm:"type:double;not null;default:-1"`
	Loss       int        `json:"loss" gorm:"type:int;not null;default:0"`
	Total      int        `json:"total" gorm:"type:int;not null;default:0"`
	Samples    []byte     `json:"samples" gorm:"type:longtext"` // JSON 数组，原始 RTT，丢包用 -1；聚合层可为空
}

func (SPPingTask) TableName() string {
	return "sp_ping_tasks"
}

func (SPPingRecord) TableName() string {
	return "sp_ping_records"
}
