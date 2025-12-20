package script

import (
	"log"
	"sync"

	"github.com/komari-monitor/komari/database/dbcore"
	"github.com/komari-monitor/komari/database/models"
	"github.com/komari-monitor/komari/ws"
	"github.com/robfig/cron/v3"
)

var (
	scriptCron   *cron.Cron
	scriptCronMu sync.Mutex
)

// ReloadScriptSchedule 从数据库读取脚本并重载调度器
func ReloadScriptSchedule() {
	scriptCronMu.Lock()
	defer scriptCronMu.Unlock()

	var scripts []models.Script
	if err := dbcore.GetDBInstance().Find(&scripts).Error; err != nil {
		log.Printf("failed to load scripts for schedule: %v", err)
		return
	}

	if scriptCron != nil {
		scriptCron.Stop()
	}
	c := cron.New(cron.WithSeconds())

	for _, s := range scripts {
		if !s.Enabled || s.TriggerKind != "cron" || s.CronExpr == "" {
			continue
		}
		scriptCopy := s
		_, err := c.AddFunc(s.CronExpr, func() {
			online := ws.GetConnectedClients()
			targets := make([]string, 0, len(scriptCopy.Clients))
			if len(scriptCopy.Clients) == 0 {
				for id := range online {
					targets = append(targets, id)
				}
			} else {
				targets = append(targets, scriptCopy.Clients...)
			}
			if len(targets) == 0 {
				return
			}
			if _, err := DispatchScript(&scriptCopy, targets, "cron", nil); err != nil {
				log.Printf("failed to dispatch cron script %d: %v", scriptCopy.ID, err)
			}
		})
		if err != nil {
			log.Printf("failed to register cron for script %d: %v", s.ID, err)
		}
	}
	c.Start()
	scriptCron = c
}
