package script

import (
	"github.com/komari-monitor/komari/database/dbcore"
	"github.com/komari-monitor/komari/database/models"
)

func UpdateClientExecutionStatus(scriptID uint, clientID, execID, dispatchStatus, execStatus, errorLog string) error {
	var s models.Script
	db := dbcore.GetDBInstance()
	if err := db.Where("id = ?", scriptID).First(&s).Error; err != nil {
		return err
	}
	statuses := s.ClientStatus
	found := false
	for i := range statuses {
		if statuses[i].ClientID == clientID {
			if execID != "" {
				statuses[i].ExecID = execID
			}
			if dispatchStatus != "" {
				statuses[i].DispatchStatus = dispatchStatus
			}
			if execStatus != "" {
				statuses[i].ExecStatus = execStatus
			}
			if errorLog != "" {
				statuses[i].ErrorLog = errorLog
			}
			statuses[i].UpdatedAt = models.Now()
			found = true
			break
		}
	}
	if !found {
		statuses = append(statuses, models.ScriptClientStatus{
			ClientID:       clientID,
			ExecID:         execID,
			DispatchStatus: dispatchStatus,
			ExecStatus:     execStatus,
			ErrorLog:       errorLog,
			UpdatedAt:      models.Now(),
		})
	}
	return db.Model(&models.Script{}).Where("id = ?", scriptID).Update("client_status", statuses).Error
}
