package record

import (
	"encoding/json"
	"math"
	"slices"
	"sort"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/komari-monitor/komari/api"
	"github.com/komari-monitor/komari/database/accounts"
	"github.com/komari-monitor/komari/database/dbcore"
	"github.com/komari-monitor/komari/database/models"
	"github.com/komari-monitor/komari/database/tasks"
)

// GetSPPingRecords SmokePing 风格延迟记录查询
// Query: uuid? task_id? hours? start? end? with_samples?
func GetSPPingRecords(c *gin.Context) {
	uuid := c.Query("uuid")
	taskIdStr := c.Query("task_id")
	withSamples := c.Query("with_samples") == "1" || c.Query("raw") == "1"
	maxCountStr := c.Query("maxCount")
	maxCount := 4000
	if maxCountStr != "" {
		if v, err := strconv.Atoi(maxCountStr); err == nil && v > 0 {
			maxCount = v
		}
	}

	// 登录状态检查（用于 Hidden 过滤）
	isLogin := false
	session, _ := c.Cookie("session_token")
	_, err := accounts.GetUserBySession(session)
	if err == nil {
		isLogin = true
	}

	// 仅在未登录时需要 Hidden 信息做过滤
	hiddenMap := map[string]bool{}
	if !isLogin {
		var hiddenClients []models.Client
		db := dbcore.GetDBInstance()
		_ = db.Select("uuid").Where("hidden = ?", true).Find(&hiddenClients).Error
		for _, cli := range hiddenClients {
			hiddenMap[cli.UUID] = true
		}
		if uuid != "" && hiddenMap[uuid] {
			api.RespondSuccess(c, gin.H{"count": 0, "records": []any{}, "tasks": []any{}})
			return
		}
	}

	hoursStr := c.Query("hours")
	startStr := c.Query("start")
	endStr := c.Query("end")

	var startTime, endTime time.Time
	if startStr != "" || endStr != "" {
		if endStr == "" {
			endTime = time.Now()
		} else {
			endTime, err = time.Parse(time.RFC3339, endStr)
			if err != nil {
				api.RespondError(c, 400, "Invalid end parameter")
				return
			}
		}
		if startStr == "" {
			startTime = endTime.Add(-time.Hour)
		} else {
			startTime, err = time.Parse(time.RFC3339, startStr)
			if err != nil {
				api.RespondError(c, 400, "Invalid start parameter")
				return
			}
		}
	} else {
		if hoursStr == "" {
			hoursStr = "4"
		}
		hoursInt, err := strconv.Atoi(hoursStr)
		if err != nil {
			hoursInt = 4
		}
		endTime = time.Now()
		startTime = endTime.Add(-time.Duration(hoursInt) * time.Hour)
	}

	taskId := -1
	if taskIdStr != "" {
		if v, err := strconv.Atoi(taskIdStr); err == nil {
			taskId = v
		}
	}

	spTasks, err := tasks.GetAllSPPingTasks()
	if err != nil {
		api.RespondError(c, 500, "Failed to fetch tasks: "+err.Error())
		return
	}

	recordsResp := []gin.H{}
	taskResp := make([]gin.H, 0, len(spTasks))
	for _, t := range spTasks {
		if taskId != -1 && int(t.Id) != taskId {
			continue
		}
		if uuid != "" && !slices.Contains(t.Clients, uuid) {
			continue
		}
		bucketStep := selectSPBucket(t.Step, startTime, endTime)
		recs, err := tasks.GetSPPingRecords(uuid, int(t.Id), startTime, endTime, bucketStep)
		if err != nil {
			api.RespondError(c, 500, "Failed to fetch records: "+err.Error())
			return
		}
		// 若无聚合数据，回退到原始 step
		if len(recs) == 0 && bucketStep > t.Step {
			if fallback, err := tasks.GetSPPingRecords(uuid, int(t.Id), startTime, endTime, t.Step); err == nil && len(fallback) > 0 {
				recs = fallback
				bucketStep = t.Step
			}
		}

		lossCount := 0
		totalCount := 0
		minLat, maxLat := -1.0, -1.0
		latest := -1.0
		var latestTs time.Time

		for _, r := range recs {
			if r.Client != "" && !isLogin && hiddenMap[r.Client] {
				continue
			}
			var samples []float64
			if len(r.Samples) > 0 && withSamples && bucketStep == t.Step {
				_ = json.Unmarshal(r.Samples, &samples)
			}
			// 若存储中的统计为空，尝试用样本重新计算，避免默认值 -1
			minV, maxV, medianV, p10V, p90V := float64(r.Min), float64(r.Max), float64(r.Median), float64(r.P10), float64(r.P90)
			if len(samples) > 0 {
				valid := make([]float64, 0, len(samples))
				for _, v := range samples {
					if v >= 0 {
						valid = append(valid, float64(v))
					}
				}
				if len(valid) > 0 {
					sort.Float64s(valid)
					minV = valid[0]
					maxV = valid[len(valid)-1]
					medianV = percentileFloat(valid, 0.5)
					p10V = percentileFloat(valid, 0.10)
					p90V = percentileFloat(valid, 0.90)
				}
			}
			lossCount += r.Loss
			totalCount += r.Total
			minLat = mergeMinFloat(minLat, minV)
			maxLat = mergeMaxFloat(maxLat, maxV)
			ts := r.Time.ToTime()
			if latestTs.IsZero() || ts.After(latestTs) {
				if medianV >= 0 {
					latest = medianV
					latestTs = ts
				}
			}

			recordsResp = append(recordsResp, gin.H{
				"task_id": t.Id,
				"time":    r.Time,
				"median":  medianV,
				"min":     minV,
				"max":     maxV,
				"p10":     p10V,
				"p90":     p90V,
				"loss":    r.Loss,
				"total":   r.Total,
				"samples": samples,
			})
		}
		lossRate := 0.0
		if totalCount > 0 {
			lossRate = float64(lossCount) / float64(totalCount) * 100
		}
		taskResp = append(taskResp, gin.H{
			"id":        t.Id,
			"name":      t.Name,
			"type":      t.Type,
			"step":      t.Step,
			"pings":     t.Pings,
			"loss":      lossRate,
			"min":       minLat,
			"max":       maxLat,
			"latest":    latest,
			"p10":       -1,
			"p90":       -1,
			"median":    latest,
			"bucket":    bucketStep,
			"timeoutMs": t.TimeoutMS,
		})
	}

	// 下采样，按任务分配
	if maxCount > 0 && len(recordsResp) > maxCount {
		grouped := make(map[uint][]gin.H)
		for _, r := range recordsResp {
			idVal, _ := r["task_id"].(uint)
			if idVal == 0 {
				if f, ok := r["task_id"].(float64); ok {
					idVal = uint(f)
				}
			}
			grouped[idVal] = append(grouped[idVal], r)
		}
		type meta struct {
			id     uint
			length int
		}
		metas := make([]struct {
			id     uint
			length int
		}, 0, len(grouped))
		totalLen := 0
		for id, arr := range grouped {
			metas = append(metas, struct {
				id     uint
				length int
			}{id: id, length: len(arr)})
			totalLen += len(arr)
			// 时间排序
			sort.Slice(arr, func(i, j int) bool {
				ti := arr[i]["time"].(models.LocalTime)
				tj := arr[j]["time"].(models.LocalTime)
				return ti.ToTime().Before(tj.ToTime())
			})
			grouped[id] = arr
		}
		if totalLen > maxCount {
			targets := allocateTargetsSP(metas, maxCount)
			down := make([]gin.H, 0, maxCount)
			for id, arr := range grouped {
				k := targets[id]
				down = append(down, sampleSPRecords(arr, k)...)
			}
			recordsResp = down
		}
	}

	api.RespondSuccess(c, gin.H{
		"count":   len(recordsResp),
		"records": recordsResp,
		"tasks":   taskResp,
		"from":    startTime,
		"to":      endTime,
	})
}

func selectSPBucket(step int, start, end time.Time) int {
	hours := end.Sub(start).Hours()
	if hours <= 48 {
		return step
	}
	if hours <= 24*30 {
		return step * 12
	}
	return step * 144
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

func allocateTargetsSP(metas []struct {
	id     uint
	length int
}, maxTotal int) map[uint]int {
	total := 0
	for _, m := range metas {
		total += m.length
	}
	if total <= maxTotal {
		out := make(map[uint]int)
		for _, m := range metas {
			out[m.id] = m.length
		}
		return out
	}
	out := make(map[uint]int)
	acc := 0
	for i, m := range metas {
		remain := maxTotal - acc
		leftGroups := len(metas) - i
		if remain <= 0 {
			out[m.id] = 0
			continue
		}
		if leftGroups == 1 {
			out[m.id] = remain
			acc += remain
			continue
		}
		share := int(math.Round(float64(maxTotal) * (float64(m.length) / float64(total))))
		if share <= 0 {
			share = 1
		}
		if share > remain-leftGroups+1 {
			share = remain - leftGroups + 1
		}
		out[m.id] = share
		acc += share
	}
	return out
}

func sampleSPRecords(in []gin.H, k int) []gin.H {
	n := len(in)
	if k <= 0 || n == 0 {
		return []gin.H{}
	}
	if k >= n {
		return in
	}
	out := make([]gin.H, 0, k)
	if k == 1 {
		return append(out, in[n-1])
	}
	for i := 0; i < k; i++ {
		idx := int(math.Round(float64(i) * float64(n-1) / float64(k-1)))
		if idx < 0 {
			idx = 0
		} else if idx >= n {
			idx = n - 1
		}
		out = append(out, in[idx])
	}
	return out
}

// percentileFloat 供本文件使用，避免跨包引用
func percentileFloat(values []float64, pct float64) float64 {
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
	lo := int(math.Floor(pos))
	hi := int(math.Ceil(pos))
	if lo == hi {
		return values[lo]
	}
	frac := pos - float64(lo)
	v := float64(values[lo]) + (float64(values[hi])-float64(values[lo]))*frac
	return math.Round(v*1000) / 1000 // 保留三位小数
}
