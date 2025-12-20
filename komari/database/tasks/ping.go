package tasks

import (
	"database/sql"
	"time"

	"github.com/komari-monitor/komari/database/dbcore"
	"github.com/komari-monitor/komari/database/models"
	"github.com/komari-monitor/komari/utils"
	"gorm.io/gorm"
)

func AddPingTask(clients []string, name string, target, task_type string, interval int) (uint, error) {
	ids, err := AddPingTasks([]models.PingTask{{
		Clients:  clients,
		Name:     name,
		Type:     task_type,
		Target:   target,
		Interval: interval,
	}})
	if err != nil {
		return 0, err
	}
	return ids[0], nil
}

func AddPingTasks(tasks []models.PingTask) ([]uint, error) {
	if len(tasks) == 0 {
		return nil, nil
	}
	db := dbcore.GetDBInstance()
	nextWeight, err := getNextPingTaskWeight(db)
	if err != nil {
		return nil, err
	}
	for i := range tasks {
		tasks[i].Weight = nextWeight + i
	}
	ids := make([]uint, 0, len(tasks))
	err = db.Transaction(func(tx *gorm.DB) error {
		for i := range tasks {
			task := tasks[i]
			if err := tx.Create(&task).Error; err != nil {
				return err
			}
			ids = append(ids, task.Id)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	ReloadPingSchedule()
	return ids, nil
}

func DeletePingTask(id []uint) error {
	db := dbcore.GetDBInstance()
	result := db.Where("id IN ?", id).Delete(&models.PingTask{})
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	ReloadPingSchedule()
	return result.Error
}

func EditPingTask(tasks []*models.PingTask) error {
	db := dbcore.GetDBInstance()
	for _, task := range tasks {
		result := db.Model(&models.PingTask{}).Where("id = ?", task.Id).Updates(task)
		if result.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}
	}
	ReloadPingSchedule()
	return nil
}

func GetAllPingTasks() ([]models.PingTask, error) {
	db := dbcore.GetDBInstance()
	var tasks []models.PingTask
	if err := db.Order("weight asc, id desc").Find(&tasks).Error; err != nil {
		return nil, err
	}
	return tasks, nil
}

func SavePingRecord(record models.PingRecord) error {
	db := dbcore.GetDBInstance()
	return db.Create(&record).Error
}

func DeletePingRecordsBefore(time time.Time) error {
	db := dbcore.GetDBInstance()
	err := db.Where("time < ?", time).Delete(&models.PingRecord{}).Error
	return err
}

func DeletePingRecords(id []uint) error {
	db := dbcore.GetDBInstance()
	result := db.Where("task_id IN ?", id).Delete(&models.PingRecord{})
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return result.Error
}

func DeleteAllPingRecords() error {
	db := dbcore.GetDBInstance()
	return db.Exec("DELETE FROM ping_records").Error
}

// OrderPingTasks 更新任务排序（权重）
func OrderPingTasks(weights map[uint]int) error {
	db := dbcore.GetDBInstance()
	for id, weight := range weights {
		if err := db.Model(&models.PingTask{}).Where("id = ?", id).Update("weight", weight).Error; err != nil {
			return err
		}
	}
	return ReloadPingSchedule()
}

func getNextPingTaskWeight(db *gorm.DB) (int, error) {
	var maxWeight sql.NullInt64
	if err := db.Model(&models.PingTask{}).Select("MAX(weight)").Scan(&maxWeight).Error; err != nil {
		return 0, err
	}
	if !maxWeight.Valid {
		return 0, nil
	}
	return int(maxWeight.Int64) + 1, nil
}
func ReloadPingSchedule() error {
	db := dbcore.GetDBInstance()
	var pingTasks []models.PingTask
	if err := db.Find(&pingTasks).Error; err != nil {
		return err
	}
	return utils.ReloadPingSchedule(pingTasks)
}

func GetPingRecords(uuid string, taskId int, start, end time.Time) ([]models.PingRecord, error) {
	db := dbcore.GetDBInstance()
	var records []models.PingRecord
	dbQuery := db.Model(&models.PingRecord{})
	if uuid != "" {
		dbQuery = dbQuery.Where("client = ?", uuid)
	}
	if taskId >= 0 {
		dbQuery = dbQuery.Where("task_id = ?", uint(taskId))
	}
	if err := dbQuery.Where("time >= ? AND time <= ?", start, end).Order("time DESC").Find(&records).Error; err != nil {
		return nil, err
	}
	return records, nil
}
