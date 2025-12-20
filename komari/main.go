package main

import (
	"log"
	"log/slog"

	"github.com/komari-monitor/komari/cmd"
	"github.com/komari-monitor/komari/utils"
	logutil "github.com/komari-monitor/komari/utils/log"
	gormlogger "gorm.io/gorm/logger"
)

func main() {
	if utils.VersionHash == "unknown" {
		logutil.SetupGlobalLogger(slog.LevelDebug)
		logutil.SetGormLogLevel(gormlogger.Info)
	} else {
		logutil.SetupGlobalLogger(slog.LevelInfo)
		logutil.SetGormLogLevel(gormlogger.Silent)
	}

	log.Printf("Komari Monitor %s (hash: %s)", utils.CurrentVersion, utils.VersionHash)

	cmd.Execute()
}
