package script

import (
	"encoding/json"
	"time"

	"github.com/komari-monitor/komari/database/dbcore"
	"github.com/komari-monitor/komari/database/models"
)

func CreateHistoryStart(scriptID uint, execID, clientUUID, triggerKind, triggerName string, startedAt time.Time) error {
	h := models.ScriptExecutionHistory{
		ScriptID:    scriptID,
		ExecID:      execID,
		ClientUUID:  clientUUID,
		Status:      "running",
		TriggerKind: triggerKind,
		TriggerName: triggerName,
		StartedAt:   models.FromTime(startedAt),
	}
	now := models.Now()
	h.CreatedAt = now
	h.UpdatedAt = now
	return dbcore.GetDBInstance().Create(&h).Error
}

func FinishHistory(scriptID uint, execID, clientUUID, status, output string, errorLog string, finishedAt time.Time) error {
	db := dbcore.GetDBInstance()
	var hist models.ScriptExecutionHistory
	err := db.Where("script_id = ? AND exec_id = ? AND client_uuid = ?", scriptID, execID, clientUUID).First(&hist).Error
	if err != nil {
		return err
	}
	logs := make(models.ScriptLogEntries, 0, len(hist.Output))
	logs = append(logs, hist.Output...)
	if output != "" {
		var parsedOutput models.ScriptLogEntries
		if err := json.Unmarshal([]byte(output), &parsedOutput); err != nil || len(parsedOutput) == 0 {
			parsedOutput = models.ScriptLogEntries{
				{
					Time:    models.FromTime(finishedAt),
					Type:    "info",
					Content: output,
				},
			}
		}
		logs = append(logs, parsedOutput...)
	}
	duration := int64(0)
	if !hist.StartedAt.ToTime().IsZero() && !finishedAt.IsZero() {
		duration = finishedAt.Sub(hist.StartedAt.ToTime()).Milliseconds()
	}
	return db.Model(&models.ScriptExecutionHistory{}).
		Where("id = ?", hist.ID).
		Updates(map[string]any{
			"status":      status,
			"output":      logs,
			"error_log":   errorLog,
			"finished_at": models.FromTime(finishedAt),
			"duration_ms": duration,
			"updated_at":  models.Now(),
		}).Error
}

func AppendHistoryOutput(scriptID uint, execID, clientUUID string, entry models.ScriptLogEntry) error {
	db := dbcore.GetDBInstance()
	var hist models.ScriptExecutionHistory
	if err := db.Where("script_id = ? AND exec_id = ? AND client_uuid = ?", scriptID, execID, clientUUID).First(&hist).Error; err != nil {
		return err
	}
	logs := hist.Output
	logs = append(logs, entry)
	return db.Model(&models.ScriptExecutionHistory{}).
		Where("id = ?", hist.ID).
		Updates(map[string]any{
			"output":     logs,
			"updated_at": models.Now(),
		}).Error
}

func ForceFinishHistory(scriptID uint, execID string, clients []string, reason string) error {
	db := dbcore.GetDBInstance()
	q := db.Model(&models.ScriptExecutionHistory{}).Where("script_id = ? AND exec_id = ?", scriptID, execID)
	if len(clients) > 0 {
		q = q.Where("client_uuid IN ?", clients)
	}
	now := models.Now()
	return q.Updates(map[string]any{
		"status":      "failed",
		"error_log":   reason,
		"finished_at": now,
		"updated_at":  now,
	}).Error
}

func ListHistory(scriptID uint, limit, offset int) ([]models.ScriptExecutionHistory, error) {
	var histories []models.ScriptExecutionHistory
	q := dbcore.GetDBInstance().Model(&models.ScriptExecutionHistory{}).Where("script_id = ?", scriptID).Order("id desc")
	if limit > 0 {
		q = q.Limit(limit)
	}
	if offset > 0 {
		q = q.Offset(offset)
	}
	if err := q.Find(&histories).Error; err != nil {
		return nil, err
	}
	return histories, nil
}

func DeleteHistoryByScriptID(scriptID uint) error {
	return dbcore.GetDBInstance().Where("script_id = ?", scriptID).Delete(&models.ScriptExecutionHistory{}).Error
}
