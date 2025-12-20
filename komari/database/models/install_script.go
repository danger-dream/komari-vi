package models

type InstallScript struct {
	ID        uint      `json:"id" gorm:"primaryKey;autoIncrement"`
	Name      string    `json:"name" gorm:"type:varchar(50);uniqueIndex;not null"` // install.sh / install.ps1
	Body      string    `json:"body" gorm:"type:longtext;not null"`
	CreatedAt LocalTime `json:"created_at"`
	UpdatedAt LocalTime `json:"updated_at"`
}

