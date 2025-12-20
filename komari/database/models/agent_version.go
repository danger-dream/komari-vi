package models

// AgentVersion 表示 Agent 的版本信息
type AgentVersion struct {
	ID        uint           `json:"id" gorm:"primaryKey"`
	Version   string         `json:"version" gorm:"type:varchar(50);uniqueIndex;not null"`
	Changelog string         `json:"changelog" gorm:"type:longtext"`
	IsCurrent bool           `json:"is_current" gorm:"default:false"`
	CreatedAt LocalTime      `json:"created_at"`
	UpdatedAt LocalTime      `json:"updated_at"`
	Packages  []AgentPackage `json:"packages,omitempty" gorm:"foreignKey:VersionID;constraint:OnDelete:CASCADE"`
}

// AgentPackage 存储各平台构建的二进制文件
type AgentPackage struct {
	ID        uint      `json:"id" gorm:"primaryKey"`
	VersionID uint      `json:"version_id" gorm:"uniqueIndex:idx_pkg_version_platform"`
	OS        string    `json:"os" gorm:"type:varchar(30);uniqueIndex:idx_pkg_version_platform"`
	Arch      string    `json:"arch" gorm:"type:varchar(30);uniqueIndex:idx_pkg_version_platform"`
	FileName  string    `json:"file_name" gorm:"type:varchar(255)"`
	Hash      string    `json:"hash" gorm:"type:varchar(64)"`
	FileSize  int64     `json:"file_size"`
	CreatedAt LocalTime `json:"created_at"`
}
