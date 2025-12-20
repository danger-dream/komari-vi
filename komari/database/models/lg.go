package models

// LgAuthorization defines Looking-Glass 授权
type LgAuthorization struct {
	ID        uint        `json:"id" gorm:"primaryKey;autoIncrement"`
	Name      string      `json:"name" gorm:"type:varchar(100);not null"`
	Remark    string      `json:"remark" gorm:"type:text"`
	Mode      string      `json:"mode" gorm:"type:varchar(16);not null"` // public, code
	Code      string      `json:"code" gorm:"type:varchar(64);index:idx_lg_authorizations_code"`
	Nodes     StringArray `json:"nodes" gorm:"type:longtext;not null"`
	Tools     StringArray `json:"tools" gorm:"type:longtext;not null"`
	ExpiresAt *LocalTime  `json:"expires_at" gorm:"type:timestamp"`
	MaxUsage  *int        `json:"max_usage"`
	UsedCount int         `json:"used_count" gorm:"default:0"`
	CreatedAt LocalTime   `json:"created_at"`
	UpdatedAt LocalTime   `json:"updated_at"`
}

// LgToolSetting 定义单个工具的超时与命令模板
type LgToolSetting struct {
	ID              uint      `json:"id" gorm:"primaryKey;autoIncrement"`
	Tool            string    `json:"tool" gorm:"type:varchar(32);uniqueIndex;not null"`
	CommandTemplate string    `json:"command_template" gorm:"type:text;not null"`
	TimeoutSeconds  int       `json:"timeout_seconds" gorm:"default:30"`
	CreatedAt       LocalTime `json:"created_at"`
	UpdatedAt       LocalTime `json:"updated_at"`
}
