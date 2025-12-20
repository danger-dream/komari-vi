package tasks

import (
	"database/sql"
	"encoding/json"
	"errors"
	"math"
	"sort"
	"time"

	"github.com/komari-monitor/komari/database/dbcore"
	"github.com/komari-monitor/komari/database/models"
	"github.com/komari-monitor/komari/utils"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// SmokePing 风格的默认保留策略
const (
	spBaseRetainHours = 48 // 原始分钟级数据保留 48h
	// 聚合倍数：step -> step*12 -> step*144
	spMidMultiplier  = 12
	spLongMultiplier = 144
)

func AddSPPingTask(clients []string, name, target, taskType string, step, pings, timeoutMS, payloadSize int) (uint, error) {
	ids, err := AddSPPingTasks([]models.SPPingTask{{
		Clients:     clients,
		Name:        name,
		Type:        taskType,
		Target:      target,
		Step:        step,
		Pings:       pings,
		TimeoutMS:   timeoutMS,
		PayloadSize: payloadSize,
	}})
	if err != nil {
		return 0, err
	}
	return ids[0], nil
}

func AddSPPingTasks(tasks []models.SPPingTask) ([]uint, error) {
	if len(tasks) == 0 {
		return nil, nil
	}
	db := dbcore.GetDBInstance()
	nextWeight, err := getNextSPPingTaskWeight(db)
	if err != nil {
		return nil, err
	}
	for i := range tasks {
		if tasks[i].Step <= 0 {
			tasks[i].Step = 300
		}
		if tasks[i].Pings <= 0 {
			tasks[i].Pings = 20
		}
		if tasks[i].TimeoutMS <= 0 {
			tasks[i].TimeoutMS = 1000
		}
		if tasks[i].PayloadSize <= 0 {
			tasks[i].PayloadSize = 56
		}
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
	ReloadSPPingSchedule()
	return ids, nil
}

func DeleteSPPingTask(id []uint) error {
	db := dbcore.GetDBInstance()
	result := db.Where("id IN ?", id).Delete(&models.SPPingTask{})
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	ReloadSPPingSchedule()
	return result.Error
}

func EditSPPingTask(tasks []*models.SPPingTask) error {
	db := dbcore.GetDBInstance()
	for _, task := range tasks {
		result := db.Model(&models.SPPingTask{}).Where("id = ?", task.Id).Updates(task)
		if result.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}
	}
	ReloadSPPingSchedule()
	return nil
}

func GetAllSPPingTasks() ([]models.SPPingTask, error) {
	db := dbcore.GetDBInstance()
	var tasks []models.SPPingTask
	if err := db.Order("weight asc, id desc").Find(&tasks).Error; err != nil {
		return nil, err
	}
	return tasks, nil
}

func GetSPPingTaskByID(id uint) (*models.SPPingTask, error) {
	db := dbcore.GetDBInstance()
	var task models.SPPingTask
	if err := db.Where("id = ?", id).First(&task).Error; err != nil {
		return nil, err
	}
	return &task, nil
}

// SaveSPPingRecord 插入或更新一条记录（按 task_id+client+time+bucket_step 去重）
func SaveSPPingRecord(record *models.SPPingRecord) error {
	if record == nil {
		return errors.New("nil record")
	}
	if record.BucketStep == 0 {
		record.BucketStep = record.Step
	}
	// 如果未带好 p10/p90/median 等，补算一次
	if len(record.Samples) > 0 {
		_ = fillSPStats(record)
	}
	db := dbcore.GetDBInstance()
	return db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "task_id"}, {Name: "client"}, {Name: "time"}, {Name: "bucket_step"}},
		DoUpdates: clause.AssignmentColumns([]string{"median", "min", "max", "p10", "p90", "loss", "total", "samples", "step", "pings"}),
	}).Create(record).Error
}

func GetSPPingRecords(uuid string, taskId int, start, end time.Time, bucketStep int) ([]models.SPPingRecord, error) {
	db := dbcore.GetDBInstance()
	var records []models.SPPingRecord
	q := db.Model(&models.SPPingRecord{})
	if uuid != "" {
		q = q.Where("client = ?", uuid)
	}
	if taskId >= 0 {
		q = q.Where("task_id = ?", uint(taskId))
	}
	if bucketStep > 0 {
		q = q.Where("bucket_step = ?", bucketStep)
	}
	if err := q.Where("time >= ? AND time <= ?", start, end).Order("time ASC").Find(&records).Error; err != nil {
		return nil, err
	}
	return records, nil
}

// AggregateSPPingRecords 将原始数据按 SmokePing 风格聚合到更大步长
func AggregateSPPingRecords(preserveHours int) error {
	db := dbcore.GetDBInstance()
	spTasks, err := GetAllSPPingTasks()
	if err != nil {
		return err
	}
	now := time.Now()
	from := now.Add(-time.Duration(preserveHours+24) * time.Hour) // 略微多抓一天保证边界

	for _, task := range spTasks {
		// 原始 -> 中级
		if err := aggregateForTask(db, task, task.Step, task.Step*spMidMultiplier, from, now); err != nil {
			return err
		}
		// 中级 -> 长期
		if err := aggregateForTask(db, task, task.Step*spMidMultiplier, task.Step*spLongMultiplier, from, now); err != nil {
			return err
		}
	}
	return nil
}

// CleanupSPPingRecords 删除超期数据
func CleanupSPPingRecords(preserveHours int) error {
	db := dbcore.GetDBInstance()
	now := time.Now()
	baseCutoff := now.Add(-time.Duration(spBaseRetainHours) * time.Hour)
	if err := db.Where("bucket_step = step AND time < ?", baseCutoff).Delete(&models.SPPingRecord{}).Error; err != nil {
		return err
	}
	aggCutoff := now.Add(-time.Duration(preserveHours) * time.Hour)
	return db.Where("bucket_step > step AND time < ?", aggCutoff).Delete(&models.SPPingRecord{}).Error
}

// DeleteAllSPPingRecords 清空所有 SP Ping 记录
func DeleteAllSPPingRecords() error {
	db := dbcore.GetDBInstance()
	return db.Exec("DELETE FROM sp_ping_records").Error
}

// ReloadSPPingSchedule 刷新调度
func ReloadSPPingSchedule() error {
	db := dbcore.GetDBInstance()
	var tasks []models.SPPingTask
	if err := db.Find(&tasks).Error; err != nil {
		return err
	}
	return utils.ReloadSPPingSchedule(tasks)
}

// 辅助：计算 p10/p50/p90/min/max
func fillSPStats(rec *models.SPPingRecord) error {
	if len(rec.Samples) == 0 {
		return nil
	}
	var samples []float64
	if err := json.Unmarshal(rec.Samples, &samples); err != nil {
		return err
	}
	valid := make([]float64, 0, len(samples))
	for _, v := range samples {
		if v >= 0 {
			valid = append(valid, v)
		}
	}
	if len(valid) == 0 {
		rec.Median, rec.Min, rec.Max, rec.P10, rec.P90 = -1, -1, -1, -1, -1
		return nil
	}
	sort.Float64s(valid)
	rec.Min = roundLatency(valid[0])
	rec.Max = roundLatency(valid[len(valid)-1])
	rec.P10 = percentileFloatLocal(valid, 0.10)
	rec.Median = percentileFloatLocal(valid, 0.50)
	rec.P90 = percentileFloatLocal(valid, 0.90)
	return nil
}

func percentileFloatLocal(values []float64, pct float64) float64 {
	if len(values) == 0 {
		return -1
	}
	if pct <= 0 {
		return values[0]
	}
	if pct >= 1 {
		return values[len(values)-1]
	}
	pos := (float64(len(values) - 1)) * pct
	lo := int(pos)
	hi := lo
	if frac := pos - float64(lo); frac > 0 {
		hi++
		if hi >= len(values) {
			hi = len(values) - 1
		}
		return math.Round((values[lo]+(values[hi]-values[lo])*frac)*1000) / 1000
	}
	return values[lo]
}

func roundLatency(v float64) float64 {
	if v < 0 {
		return v
	}
	return math.Round(v*1000) / 1000
}

func aggregateForTask(db *gorm.DB, task models.SPPingTask, srcStep, targetStep int, from, to time.Time) error {
	if targetStep <= srcStep {
		return nil
	}
	window := time.Duration(targetStep) * time.Second
	var source []models.SPPingRecord
	if err := db.Where("task_id = ? AND bucket_step = ? AND time >= ? AND time <= ?", task.Id, srcStep, from, to).Find(&source).Error; err != nil {
		return err
	}
	if len(source) == 0 {
		return nil
	}
	type groupedKey struct {
		Client string
		Time   time.Time
	}
	grouped := make(map[groupedKey][]models.SPPingRecord)
	for _, r := range source {
		ts := r.Time.ToTime().Truncate(window)
		key := groupedKey{Client: r.Client, Time: ts}
		grouped[key] = append(grouped[key], r)
	}

	for key, recs := range grouped {
		loss := 0
		total := 0
		allSamples := make([]float64, 0, len(recs)*task.Pings)
		minV, maxV := -1.0, -1.0
		for _, r := range recs {
			loss += r.Loss
			total += r.Total
			minV = mergeMinFloat(minV, r.Min)
			maxV = mergeMaxFloat(maxV, r.Max)
			s := extractSamples(r)
			if len(s) == 0 && r.Median > 0 {
				s = append(s, r.Min, r.P10, r.Median, r.P90, r.Max)
			}
			allSamples = append(allSamples, s...)
		}
		median, p10, p90 := -1.0, -1.0, -1.0
		if len(allSamples) > 0 {
			sort.Float64s(allSamples)
			median = percentileFloatLocal(allSamples, 0.5)
			p10 = percentileFloatLocal(allSamples, 0.10)
			p90 = percentileFloatLocal(allSamples, 0.90)
		}
		minV = roundLatency(minV)
		maxV = roundLatency(maxV)
		median = roundLatency(median)
		p10 = roundLatency(p10)
		p90 = roundLatency(p90)
		newRec := models.SPPingRecord{
			TaskId:     task.Id,
			Client:     key.Client,
			Time:       models.FromTime(key.Time),
			BucketStep: targetStep,
			Step:       task.Step,
			Pings:      task.Pings,
			Median:     median,
			P10:        p10,
			P90:        p90,
			Min:        minV,
			Max:        maxV,
			Loss:       loss,
			Total:      total,
		}
		if err := db.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "task_id"}, {Name: "client"}, {Name: "time"}, {Name: "bucket_step"}},
			DoUpdates: clause.AssignmentColumns([]string{"median", "min", "max", "p10", "p90", "loss", "total", "step", "pings"}),
		}).Create(&newRec).Error; err != nil {
			return err
		}
	}
	return nil
}

func extractSamples(r models.SPPingRecord) []float64 {
	if len(r.Samples) == 0 {
		return nil
	}
	var arr []float64
	if err := json.Unmarshal(r.Samples, &arr); err != nil {
		return nil
	}
	out := make([]float64, 0, len(arr))
	for _, v := range arr {
		if v >= 0 {
			out = append(out, v)
		}
	}
	return out
}

func mergeMinFloat(cur, v float64) float64 {
	if v < 0 {
		return cur
	}
	if cur == -1 || v < cur {
		return v
	}
	return cur
}

func mergeMaxFloat(cur, v float64) float64 {
	if v < 0 {
		return cur
	}
	if cur == -1 || v > cur {
		return v
	}
	return cur
}

// OrderSPPingTasks 更新排序（权重）
func OrderSPPingTasks(weights map[uint]int) error {
	db := dbcore.GetDBInstance()
	for id, weight := range weights {
		if err := db.Model(&models.SPPingTask{}).Where("id = ?", id).Update("weight", weight).Error; err != nil {
			return err
		}
	}
	return ReloadSPPingSchedule()
}

func getNextSPPingTaskWeight(db *gorm.DB) (int, error) {
	var maxWeight sql.NullInt64
	if err := db.Model(&models.SPPingTask{}).Select("MAX(weight)").Scan(&maxWeight).Error; err != nil {
		return 0, err
	}
	if !maxWeight.Valid {
		return 0, nil
	}
	return int(maxWeight.Int64) + 1, nil
}
