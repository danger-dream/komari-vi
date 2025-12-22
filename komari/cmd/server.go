package cmd

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/komari-monitor/komari/api"
	"github.com/komari-monitor/komari/api/admin"
	"github.com/komari-monitor/komari/api/admin/clipboard"
	log_api "github.com/komari-monitor/komari/api/admin/log"
	"github.com/komari-monitor/komari/api/admin/notification"
	"github.com/komari-monitor/komari/api/admin/test"
	"github.com/komari-monitor/komari/api/admin/update"
	"github.com/komari-monitor/komari/api/client"
	"github.com/komari-monitor/komari/api/jsonRpc"
	"github.com/komari-monitor/komari/api/record"
	"github.com/komari-monitor/komari/api/task"
	"github.com/komari-monitor/komari/cmd/flags"
	"github.com/komari-monitor/komari/database"
	"github.com/komari-monitor/komari/database/accounts"
	"github.com/komari-monitor/komari/database/agentversion"
	"github.com/komari-monitor/komari/database/auditlog"
	"github.com/komari-monitor/komari/database/config"
	"github.com/komari-monitor/komari/database/dbcore"
	"github.com/komari-monitor/komari/database/installscripts"
	"github.com/komari-monitor/komari/database/lg"
	"github.com/komari-monitor/komari/database/models"
	d_notification "github.com/komari-monitor/komari/database/notification"
	"github.com/komari-monitor/komari/database/records"
	scriptsched "github.com/komari-monitor/komari/database/script"
	"github.com/komari-monitor/komari/database/security"
	"github.com/komari-monitor/komari/database/tasks"
	"github.com/komari-monitor/komari/public"
	"github.com/komari-monitor/komari/utils"
	"github.com/komari-monitor/komari/utils/cloudflared"
	"github.com/komari-monitor/komari/utils/geoip"
	logutil "github.com/komari-monitor/komari/utils/log"
	"github.com/komari-monitor/komari/utils/messageSender"
	"github.com/komari-monitor/komari/utils/notifier"
	"github.com/komari-monitor/komari/utils/oauth"
	"github.com/spf13/cobra"
)

var (
	DynamicCorsEnabled bool = false
)

var ServerCmd = &cobra.Command{
	Use:   "server",
	Short: "Start the server",
	Long:  `Start the server`,
	Run: func(cmd *cobra.Command, args []string) {
		RunServer()
	},
}

func init() {
	// 从环境变量获取监听地址
	listenAddr := GetEnv("KOMARI_LISTEN", "0.0.0.0:25774")
	ServerCmd.PersistentFlags().StringVarP(&flags.Listen, "listen", "l", listenAddr, "监听地址 [env: KOMARI_LISTEN]")
	RootCmd.AddCommand(ServerCmd)
}

func RunServer() {
	// #region 初始化
	if err := os.MkdirAll("./data", os.ModePerm); err != nil {
		log.Fatalf("Failed to create data directory: %v", err)
	}
	// 创建主题目录
	if err := os.MkdirAll("./data/theme", os.ModePerm); err != nil {
		log.Fatalf("Failed to create theme directory: %v", err)
	}
	if err := agentversion.EnsurePackageDir(); err != nil {
		log.Fatalf("Failed to create package directory: %v", err)
	}
	InitDatabase()
	if err := installscripts.EnsureDefaults(); err != nil {
		log.Fatalf("Failed to init install scripts: %v", err)
	}
	lg.EnsureAuthorizationIndexes()
	if err := security.EnsureSecurityConfig(); err != nil {
		log.Fatalf("Failed to init security config: %v", err)
	}
	if err := lg.EnsureDefaultToolSettings(); err != nil {
		log.Fatalf("Failed to init LG tool settings: %v", err)
	}
	if utils.VersionHash != "unknown" {
		gin.SetMode(gin.ReleaseMode)
	}
	conf, err := config.Get()
	if err != nil {
		log.Fatal(err)
	}
	go geoip.InitGeoIp()
	go DoScheduledWork()
	go messageSender.Initialize()
	// oidcInit
	go oauth.Initialize()

	if conf.NezhaCompatEnabled {
		go func() {
			if err := StartNezhaCompat(conf.NezhaCompatListen); err != nil {
				log.Printf("Nezha compat server error: %v", err)
				auditlog.EventLog("error", fmt.Sprintf("Nezha compat server error: %v", err))
			}
		}()
	}

	config.Subscribe(func(event config.ConfigEvent) {
		if event.New.OAuthProvider != event.Old.OAuthProvider {
			oidcProvider, err := database.GetOidcConfigByName(event.New.OAuthProvider)
			if err != nil {
				log.Printf("Failed to get OIDC provider config: %v", err)
			} else {
				log.Printf("Using %s as OIDC provider", oidcProvider.Name)
			}
			err = oauth.LoadProvider(oidcProvider.Name, oidcProvider.Addition)
			if err != nil {
				auditlog.EventLog("error", fmt.Sprintf("Failed to load OIDC provider: %v", err))
			}
		}
		if event.New.NotificationMethod != event.Old.NotificationMethod {
			messageSender.Initialize()
		}
		if event.New.NezhaCompatEnabled != event.Old.NezhaCompatEnabled {
			if event.New.NezhaCompatEnabled {
				if err := StartNezhaCompat(event.New.NezhaCompatListen); err != nil {
					log.Printf("start Nezha compat server error: %v", err)
					auditlog.EventLog("error", fmt.Sprintf("start Nezha compat server error: %v", err))
				}
			} else {
				if err := StopNezhaCompat(); err != nil {
					log.Printf("stop Nezha compat server error: %v", err)
					auditlog.EventLog("error", fmt.Sprintf("stop Nezha compat server error: %v", err))
				}
			}
		}

	})
	// 初始化 cloudflared
	if strings.ToLower(GetEnv("KOMARI_ENABLE_CLOUDFLARED", "false")) == "true" {
		err := cloudflared.RunCloudflared() // 阻塞，确保cloudflared跑起来
		if err != nil {
			log.Fatalf("Failed to run cloudflared: %v", err)
		}
	}

	r := gin.New()
	r.Use(logutil.GinLogger())
	r.Use(logutil.GinRecovery())

	// 动态 CORS 中间件

	DynamicCorsEnabled = conf.AllowCors
	config.Subscribe(func(event config.ConfigEvent) {
		DynamicCorsEnabled = event.New.AllowCors
		if event.New.GeoIpProvider != event.Old.GeoIpProvider {
			go geoip.InitGeoIp()
		}
		if event.New.NotificationMethod != event.Old.NotificationMethod {
			go messageSender.Initialize()
		}
	})
	r.Use(func(c *gin.Context) {
		if DynamicCorsEnabled {
			c.Header("Access-Control-Allow-Origin", "*")
			c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS")
			c.Header("Access-Control-Allow-Headers", "Origin, Content-Length, Content-Type, Authorization, Accept, X-CSRF-Token, X-Requested-With, Set-Cookie")
			c.Header("Access-Control-Expose-Headers", "Content-Length, Authorization, Set-Cookie")
			c.Header("Access-Control-Allow-Credentials", "true")
			c.Header("Access-Control-Max-Age", "43200") // 12 hours
			if c.Request.Method == "OPTIONS" {
				c.AbortWithStatus(204)
				return
			}
		}
		c.Next()
	})

	r.Use(api.PrivateSiteMiddleware())

	r.Use(func(c *gin.Context) {
		if len(c.Request.URL.Path) >= 4 && c.Request.URL.Path[:4] == "/api" {
			c.Header("Cache-Control", "no-store")
		}
		c.Next()
	})

	r.Any("/ping", func(c *gin.Context) {
		c.String(200, "pong")
	})
	// #region 公开路由
	r.POST("/api/login", api.Login)
	r.GET("/api/me", api.GetMe)
	r.GET("/api/clients", api.GetClients)
	r.GET("/api/nodes", api.GetNodesInformation)
	r.GET("/api/public", api.GetPublicSettings)
	r.GET("/api/oauth", api.OAuth)
	r.GET("/api/oauth_callback", api.OAuthCallback)
	r.GET("/api/logout", api.Logout)
	r.GET("/api/version", api.GetVersion)
	r.GET("/api/recent/:uuid", api.GetClientRecentRecords)
	// looking-glass
	r.GET("/api/lg/public-nodes", api.GetPublicLgNodes)
	r.POST("/api/lg/verify-code", api.VerifyLgCode)
	r.POST("/api/lg/session/start", api.StartLgSession)
	r.GET("/api/lg/session/ws", api.LgBrowserWS)

	// install scripts & agent package (public)
	r.GET("/api/public/install.sh", api.GetInstallScriptSh)
	r.GET("/api/public/install.ps1", api.GetInstallScriptPs1)
	r.GET("/api/public/agent/package", api.DownloadAgentPackagePublic)

	r.GET("/api/records/load", record.GetRecordsByUUID)
	r.GET("/api/records/ping", record.GetPingRecords)
	r.GET("/api/records/sp_ping", record.GetSPPingRecords)
	r.GET("/api/task/ping", task.GetPublicPingTasks)
	r.GET("/api/task/sp_ping", task.GetPublicSPPingTasks)
	r.GET("/api/rpc2", jsonRpc.OnRpcRequest)
	r.POST("/api/rpc2", jsonRpc.OnRpcRequest)

	// #region Agent
	r.POST("/api/clients/register", client.RegisterClient)
	tokenAuthrized := r.Group("/api/clients", api.TokenAuthMiddleware())
	{
		tokenAuthrized.GET("/report", client.WebSocketReport) // websocket
		tokenAuthrized.POST("/uploadBasicInfo", client.UploadBasicInfo)
		tokenAuthrized.POST("/report", client.UploadReport)
		tokenAuthrized.GET("/terminal", client.EstablishConnection)
		tokenAuthrized.GET("/lg", client.ClientLgWS)
		tokenAuthrized.POST("/task/result", client.TaskResult)
		tokenAuthrized.GET("/update", client.GetAgentUpdate)
		tokenAuthrized.GET("/package/:id", client.DownloadAgentPackage)
		tokenAuthrized.POST("/script/history/start", client.ScriptHistoryStart)
		tokenAuthrized.POST("/script/history/result", client.ScriptHistoryResult)
		tokenAuthrized.POST("/script/storage/get", client.ScriptStorageGet)
		tokenAuthrized.POST("/script/storage/set", client.ScriptStorageSet)
	}
	// #region 管理员
	adminAuthrized := r.Group("/api/admin", api.AdminAuthMiddleware())
	{
		adminAuthrized.GET("/download/backup", admin.DownloadBackup)
		adminAuthrized.POST("/upload/backup", admin.UploadBackup)
		// test
		testGroup := adminAuthrized.Group("/test")
		{
			testGroup.GET("/geoip", test.TestGeoIp)
			testGroup.POST("/sendMessage", test.TestSendMessage)
		}
		// update
		updateGroup := adminAuthrized.Group("/update")
		{
			updateGroup.POST("/mmdb", update.UpdateMmdbGeoIP)
			updateGroup.POST("/user", update.UpdateUser)
			updateGroup.PUT("/favicon", update.UploadFavicon)
			updateGroup.POST("/favicon", update.DeleteFavicon)
		}
		// tasks
		taskGroup := adminAuthrized.Group("/task")
		{
			taskGroup.GET("/all", admin.GetTasks)
			taskGroup.POST("/exec", admin.Exec)
			taskGroup.GET("/:task_id", admin.GetTaskById)
			taskGroup.GET("/:task_id/result", admin.GetTaskResultsByTaskId)
			taskGroup.GET("/:task_id/result/:uuid", admin.GetSpecificTaskResult)
			taskGroup.GET("/client/:uuid", admin.GetTasksByClientId)
		}
		// settings
		settingsGroup := adminAuthrized.Group("/settings")
		{
			settingsGroup.GET("/", admin.GetSettings)
			settingsGroup.POST("/", admin.EditSettings)
			settingsGroup.POST("/oidc", admin.SetOidcProvider)
			settingsGroup.GET("/oidc", admin.GetOidcProvider)
			settingsGroup.POST("/message-sender", admin.SetMessageSenderProvider)
			settingsGroup.GET("/message-sender", admin.GetMessageSenderProvider)
		}
		securityGroup := adminAuthrized.Group("/security")
		{
			securityGroup.GET("", admin.GetSecurityConfig)
			securityGroup.POST("", admin.UpdateSecurityConfig)
		}
		// themes
		themeGroup := adminAuthrized.Group("/theme")
		{
			themeGroup.PUT("/upload", admin.UploadTheme)
			themeGroup.GET("/list", admin.ListThemes)
			themeGroup.POST("/delete", admin.DeleteTheme)
			themeGroup.GET("/set", admin.SetTheme)
			themeGroup.POST("/update", admin.UpdateTheme)
			themeGroup.POST("/settings", admin.UpdateThemeSettings)
		}
		agentVersionGroup := adminAuthrized.Group("/agent-version")
		{
			// 兼容是否携带尾部斜杠，避免 POST multipart 在 307 重定向下卡住
			agentVersionGroup.GET("", admin.ListAgentVersions)
			agentVersionGroup.GET("/", admin.ListAgentVersions)
			agentVersionGroup.POST("", admin.CreateAgentVersion)
			agentVersionGroup.POST("/", admin.CreateAgentVersion)
			agentVersionGroup.DELETE("/:id", admin.DeleteAgentVersion)
			agentVersionGroup.POST("/:id/upload", admin.UploadAgentPackages)
			agentVersionGroup.POST("/:id/metadata", admin.UpdateAgentVersionMetadata)
			agentVersionGroup.DELETE("/:id/package/:package_id", admin.DeleteAgentPackage)
			agentVersionGroup.GET("/:id/package/:package_id/download", admin.DownloadAgentPackage)
		}
		installScriptGroup := adminAuthrized.Group("/install-script")
		{
			installScriptGroup.GET("/", admin.ListInstallScripts)
			installScriptGroup.POST("/:name", admin.UpdateInstallScript)
		}
		credentialGroup := adminAuthrized.Group("/credential")
		{
			credentialGroup.GET("/", admin.ListCredentials)
			credentialGroup.POST("/", admin.CreateCredential)
			credentialGroup.POST("/:id", admin.UpdateCredential)
			credentialGroup.DELETE("/:id", admin.DeleteCredential)
			credentialGroup.GET("/:id/reveal", admin.RevealCredentialSecret)
		}
		sshGroup := adminAuthrized.Group("/ssh")
		{
			sshGroup.POST("/test", admin.TestSSHConnection)
			sshGroup.POST("/install", admin.StartSSHInstall)
			sshGroup.GET("/install/:id/stream", admin.StreamSSHInstall)
			sshGroup.GET("/install/:id", admin.GetSSHInstallStatus)
		}
		// clients
		clientGroup := adminAuthrized.Group("/client")
		{
			clientGroup.POST("/add", admin.AddClient)
			clientGroup.GET("/list", admin.ListClients)
			clientGroup.GET("/:uuid", admin.GetClient)
			clientGroup.POST("/:uuid/edit", admin.EditClient)
			clientGroup.POST("/:uuid/remove", admin.RemoveClient)
			clientGroup.GET("/:uuid/token", admin.GetClientToken)
			clientGroup.POST("/order", admin.OrderWeight)
			// client terminal
			clientGroup.GET("/:uuid/terminal", api.RequestTerminal)
		}

		// forward management
		forwardGroup := adminAuthrized.Group("/forward")
		{
			forwardGroup.GET("", admin.ListForwards)
			forwardGroup.POST("", admin.CreateForward)
			forwardGroup.GET("/:id", admin.GetForward)
			forwardGroup.PUT("/:id", admin.UpdateForward)
			forwardGroup.DELETE("/:id", admin.DeleteForward)
			forwardGroup.POST("/:id/enable", admin.EnableForward)
			forwardGroup.POST("/:id/disable", admin.DisableForward)
			forwardGroup.GET("/system-settings", admin.GetForwardSystemSettings)
			forwardGroup.PUT("/system-settings", admin.UpdateForwardSystemSettings)
			forwardGroup.GET("/realm-template", admin.GetRealmTemplate)
			forwardGroup.PUT("/realm-template", admin.UpdateRealmTemplate)
		}
		// alias per design (/api/v1/forwards)
		v1Forward := r.Group("/api/v1/forwards", api.AdminAuthMiddleware())
		{
			v1Forward.GET("", admin.ListForwards)
			v1Forward.POST("", admin.CreateForward)
			v1Forward.GET("/:id", admin.GetForward)
			v1Forward.PUT("/:id", admin.UpdateForward)
			v1Forward.DELETE("/:id", admin.DeleteForward)
			v1Forward.POST("/:id/enable", admin.EnableForward)
			v1Forward.POST("/:id/disable", admin.DisableForward)
			v1Forward.POST("/:id/start", admin.StartForward)
			v1Forward.POST("/:id/stop", admin.StopForward)
			v1Forward.POST("/:id/apply-configs", admin.ApplyForwardConfigs)
			v1Forward.GET("/system-settings", admin.GetForwardSystemSettings)
			v1Forward.PUT("/system-settings", admin.UpdateForwardSystemSettings)
			v1Forward.GET("/realm/default-config", admin.GetRealmTemplate)
			v1Forward.PUT("/realm/default-config", admin.UpdateRealmTemplate)
			v1Forward.POST("/check-port", admin.CheckPort)
			v1Forward.POST("/preview-config", admin.PreviewForwardRealmConfig)
			v1Forward.GET("/:id/alert-config", admin.GetForwardAlertConfig)
			v1Forward.POST("/:id/alert-config", admin.UpdateForwardAlertConfig)
			v1Forward.GET("/:id/stats", admin.GetForwardStats)
			v1Forward.GET("/:id/topology", admin.GetForwardTopology)
			v1Forward.GET("/:id/logs", admin.ListForwardLogs)
			v1Forward.GET("/:id/logs/:nodeId", admin.GetForwardLog)
			v1Forward.DELETE("/:id/logs/:nodeId", admin.DeleteForwardLog)
			v1Forward.POST("/:id/logs/:nodeId/clear", admin.ClearForwardLog)
			v1Forward.POST("/test-connectivity", admin.TestConnectivity)
			v1Forward.GET("/:id/alert-history", admin.GetForwardAlertHistory)
			v1Forward.POST("/:id/alert-history/:alertId/acknowledge", admin.AcknowledgeForwardAlert)
		}
		v1Realm := r.Group("/api/v1/realm", api.AdminAuthMiddleware())
		{
			v1Realm.POST("/binaries", admin.UploadRealmBinary)
			v1Realm.GET("/binaries", admin.ListRealmBinaries)
			v1Realm.DELETE("/binaries/:id", admin.DeleteRealmBinary)
			v1Realm.GET("/binaries/:id/download", admin.DownloadRealmBinary)
		}
		r.GET("/api/v1/realm/binaries/download", api.DownloadRealmBinaryPublic)
		// agent config sync
		r.POST("/api/v1/forwards/:id/config/sync", api.TokenAuthMiddleware(), api.ForwardConfigSync)
		// agent task run (forward tasks)
		r.POST("/api/v1/agents/run_task", api.AdminAuthMiddleware(), admin.RunAgentTask)

		// records
		recordGroup := adminAuthrized.Group("/record")
		{
			recordGroup.POST("/clear", admin.ClearRecord)
			recordGroup.POST("/clear/all", admin.ClearAllRecords)
		}
		// oauth2
		oauth2Group := adminAuthrized.Group("/oauth2")
		{
			oauth2Group.GET("/bind", admin.BindingExternalAccount)
			oauth2Group.POST("/unbind", admin.UnbindExternalAccount)
		}
		sessionGroup := adminAuthrized.Group("/session")
		{
			sessionGroup.GET("/get", admin.GetSessions)
			sessionGroup.POST("/remove", admin.DeleteSession)
			sessionGroup.POST("/remove/all", admin.DeleteAllSession)
		}
		two_factorGroup := adminAuthrized.Group("/2fa")
		{
			two_factorGroup.GET("/generate", admin.Generate2FA)
			two_factorGroup.POST("/enable", admin.Enable2FA)
			two_factorGroup.POST("/disable", admin.Disable2FA)
		}
		adminAuthrized.GET("/logs", log_api.GetLogs)

		// clipboard
		clipboardGroup := adminAuthrized.Group("/clipboard")
		{
			clipboardGroup.GET("/:id", clipboard.GetClipboard)
			clipboardGroup.GET("", clipboard.ListClipboard)
			clipboardGroup.POST("", clipboard.CreateClipboard)
			clipboardGroup.POST("/:id", clipboard.UpdateClipboard)
			clipboardGroup.POST("/remove", clipboard.BatchDeleteClipboard)
			clipboardGroup.POST("/:id/remove", clipboard.DeleteClipboard)
		}

		notificationGroup := adminAuthrized.Group("/notification")
		{
			// offline notifications
			notificationGroup.GET("/offline", notification.ListOfflineNotifications)
			notificationGroup.POST("/offline/edit", notification.EditOfflineNotification)
			notificationGroup.POST("/offline/enable", notification.EnableOfflineNotification)
			notificationGroup.POST("/offline/disable", notification.DisableOfflineNotification)
			loadAlertGroup := notificationGroup.Group("/load")
			{
				loadAlertGroup.GET("/", notification.GetAllLoadNotifications)
				loadAlertGroup.POST("/add", notification.AddLoadNotification)
				loadAlertGroup.POST("/delete", notification.DeleteLoadNotification)
				loadAlertGroup.POST("/edit", notification.EditLoadNotification)
			}
		}

		pingTaskGroup := adminAuthrized.Group("/ping")
		{
			pingTaskGroup.GET("/", admin.GetAllPingTasks)
			pingTaskGroup.POST("/add", admin.AddPingTask)
			pingTaskGroup.POST("/delete", admin.DeletePingTask)
			pingTaskGroup.POST("/edit", admin.EditPingTask)
			pingTaskGroup.POST("/order", admin.OrderPingTask)
			pingTaskGroup.POST("/clear", admin.ClearPingRecords)

		}
		spPingGroup := adminAuthrized.Group("/sp-ping")
		{
			spPingGroup.GET("/", admin.GetAllSPPingTasks)
			spPingGroup.POST("/add", admin.AddSPPingTask)
			spPingGroup.POST("/delete", admin.DeleteSPPingTask)
			spPingGroup.POST("/edit", admin.EditSPPingTask)
			spPingGroup.POST("/order", admin.OrderSPPingTask)
			spPingGroup.POST("/clear", admin.ClearSPPingRecords)
		}
		// scripts
		scriptGroup := adminAuthrized.Group("/script")
		{
			scriptGroup.GET("/structure", admin.GetScriptStructure)
			scriptGroup.POST("/folder/add", admin.AddScriptFolder)
			scriptGroup.POST("/folder/edit", admin.EditScriptFolder)
			scriptGroup.POST("/folder/delete", admin.DeleteScriptFolder)
			scriptGroup.GET("", admin.GetScripts)
			scriptGroup.POST("/add", admin.AddScript)
			scriptGroup.POST("/edit", admin.EditScript)
			scriptGroup.POST("/delete", admin.DeleteScript)
			scriptGroup.POST("/execute", admin.ExecuteScript)
			scriptGroup.POST("/stop", admin.StopScript)
			scriptGroup.POST("/force_stop", admin.ForceStopScript)
			scriptGroup.GET("/history", admin.GetScriptHistory)
			scriptGroup.GET("/variables", admin.GetScriptVariables)
			scriptGroup.POST("/variable/set", admin.SetScriptVariable)
			scriptGroup.POST("/variable/delete", admin.DeleteScriptVariable)
		}

		// looking-glass 管理
		lgGroup := adminAuthrized.Group("/lg")
		{
			lgGroup.GET("/authorization", admin.ListLgAuthorizations)
			lgGroup.POST("/authorization", admin.CreateLgAuthorization)
			lgGroup.POST("/authorization/update", admin.UpdateLgAuthorization)
			lgGroup.POST("/authorization/delete", admin.DeleteLgAuthorization)
			lgGroup.GET("/tool-setting", admin.GetLgToolSettings)
			lgGroup.POST("/tool-setting", admin.UpdateLgToolSettings)
		}

	}

	public.Static(r.Group("/"), func(handlers ...gin.HandlerFunc) {
		r.NoRoute(handlers...)
	})
	// #region 静态文件服务
	public.UpdateIndex(conf)
	config.Subscribe(func(event config.ConfigEvent) {
		public.UpdateIndex(event.New)
	})

	srv := &http.Server{
		Addr:    flags.Listen,
		Handler: r,
	}
	log.Printf("Starting server on %s ...", flags.Listen)
	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			OnFatal(err)
			log.Fatalf("listen: %s\n", err)
		}
	}()
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, os.Interrupt, syscall.SIGTERM)
	<-quit
	OnShutdown()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("Server forced to shutdown: %v", err)
	}

}

func InitDatabase() {
	// // 打印数据库类型和连接信息
	// if flags.DatabaseType == "mysql" {
	// 	log.Printf("使用 MySQL 数据库连接: %s@%s:%s/%s",
	// 		flags.DatabaseUser, flags.DatabaseHost, flags.DatabasePort, flags.DatabaseName)
	// 	log.Printf("环境变量配置: [KOMARI_DB_TYPE=%s] [KOMARI_DB_HOST=%s] [KOMARI_DB_PORT=%s] [KOMARI_DB_USER=%s] [KOMARI_DB_NAME=%s]",
	// 		os.Getenv("KOMARI_DB_TYPE"), os.Getenv("KOMARI_DB_HOST"), os.Getenv("KOMARI_DB_PORT"),
	// 		os.Getenv("KOMARI_DB_USER"), os.Getenv("KOMARI_DB_NAME"))
	// } else {
	// 	log.Printf("使用 SQLite 数据库文件: %s", flags.DatabaseFile)
	// 	log.Printf("环境变量配置: [KOMARI_DB_TYPE=%s] [KOMARI_DB_FILE=%s]",
	// 		os.Getenv("KOMARI_DB_TYPE"), os.Getenv("KOMARI_DB_FILE"))
	// }
	var count int64 = 0
	if dbcore.GetDBInstance().Model(&models.User{}).Count(&count); count == 0 {
		user, passwd, err := accounts.CreateDefaultAdminAccount()
		if err != nil {
			panic(err)
		}
		log.Println("Default admin account created. Username:", user, ", Password:", passwd)
	}
}

// #region 定时任务
func DoScheduledWork() {
	tasks.ReloadPingSchedule()
	tasks.ReloadSPPingSchedule()
	d_notification.ReloadLoadNotificationSchedule()
	scriptsched.ReloadScriptSchedule()
	ticker := time.NewTicker(time.Minute * 30)
	minute := time.NewTicker(60 * time.Second)
	//records.DeleteRecordBefore(time.Now().Add(-time.Hour * 24 * 30))
	records.CompactRecord()
	cfg, _ := config.Get()
	go notifier.CheckExpireScheduledWork()
	for {
		select {
		case <-ticker.C:
			records.DeleteRecordBefore(time.Now().Add(-time.Hour * time.Duration(cfg.RecordPreserveTime)))
			records.CompactRecord()
			tasks.ClearTaskResultsByTimeBefore(time.Now().Add(-time.Hour * time.Duration(cfg.RecordPreserveTime)))
			tasks.DeletePingRecordsBefore(time.Now().Add(-time.Hour * time.Duration(cfg.PingRecordPreserveTime)))
			_ = tasks.AggregateSPPingRecords(cfg.SpRecordPreserveHours)
			_ = tasks.CleanupSPPingRecords(cfg.SpRecordPreserveHours)
			auditlog.RemoveOldLogs()
		case <-minute.C:
			api.SaveClientReportToDB()
			if !cfg.RecordEnabled {
				records.DeleteAll()
				tasks.DeleteAllPingRecords()
				_ = tasks.CleanupSPPingRecords(cfg.SpRecordPreserveHours)
			}
			// 每分钟检查一次流量提醒
			go notifier.CheckTraffic()
		}
	}

}

func OnShutdown() {
	auditlog.Log("", "", "server is shutting down", "info")
	cloudflared.Kill()
}

func OnFatal(err error) {
	auditlog.Log("", "", "server encountered a fatal error: "+err.Error(), "error")
	cloudflared.Kill()
}
