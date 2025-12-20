package models

type CredentialType string

const (
	CredentialTypePassword CredentialType = "password"
	CredentialTypeKey      CredentialType = "key"
)

type Credential struct {
	ID        uint           `json:"id" gorm:"primaryKey;autoIncrement"`
	Name      string         `json:"name" gorm:"type:varchar(100);uniqueIndex;not null"`
	Username  string         `json:"username" gorm:"type:varchar(100);not null"`
	Type      CredentialType `json:"type" gorm:"type:varchar(20);not null"`
	SecretEnc string         `json:"-" gorm:"type:longtext;not null"`
	// PassphraseEnc 用于加密私钥口令（仅 type=key 时可用）
	PassphraseEnc string `json:"-" gorm:"type:longtext;default:''"`
	Remark    string         `json:"remark" gorm:"type:text;default:''"`
	CreatedAt LocalTime      `json:"created_at"`
	UpdatedAt LocalTime      `json:"updated_at"`
}
