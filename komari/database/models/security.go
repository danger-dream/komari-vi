package models

// SecurityConfig 持久化安全管控配置
type SecurityConfig struct {
	ID uint `json:"id" gorm:"primaryKey;autoIncrement"`

	// 签名与防重放
	SignatureEnabled bool        `json:"signature_enabled" gorm:"default:false"`
	SignatureSecret  string      `json:"signature_secret" gorm:"type:varchar(128)"`
	SignatureTTL     int         `json:"signature_ttl_seconds" gorm:"default:300"` // 允许的时间偏移秒
	NonceTTL         int         `json:"nonce_ttl_seconds" gorm:"default:300"`
	NonceCacheSize   int         `json:"nonce_cache_size" gorm:"default:2000"`
	RequireOrigin    bool        `json:"require_origin" gorm:"default:false"`
	AllowedOrigins   StringArray `json:"allowed_origins" gorm:"type:longtext"`
	AllowedReferers  StringArray `json:"allowed_referers" gorm:"type:longtext"`

	// 频率与封禁
	RatePublicPerMin int `json:"rate_public_per_min" gorm:"default:60"`
	RateVerifyPerMin int `json:"rate_verify_per_min" gorm:"default:30"`
	RateStartPerMin  int `json:"rate_start_per_min" gorm:"default:20"`

	MaxFailuresPerIP    int `json:"max_failures_per_ip" gorm:"default:5"`
	FailureLockMinutes  int `json:"failure_lock_minutes" gorm:"default:30"`
	FailureWindowSecond int `json:"failure_window_seconds" gorm:"default:900"`

	CreatedAt LocalTime `json:"created_at"`
	UpdatedAt LocalTime `json:"updated_at"`
}
