// 配置类型定义
export interface ConfigOptions {
	backgroundImage?: string // 背景图片URL
	enableVideoBackground?: boolean // 是否启用视频背景
	videoBackgroundUrl?: string // 视频背景URL
	blurValue?: number // 磨砂玻璃模糊值
	blurBackgroundColor?: string // 磨砂玻璃背景颜色
	enableTransparentTags?: boolean // 是否启用标签透明背景
	tagDefaultColorList?: string // 标签默认颜色列表
	selectThemeColor?: string // 默认主题颜色
	enableLocalStorage?: boolean // 是否启用本地存储
	selectedDefaultView?: 'grid' | 'table' // 默认视图模式
	selectedDefaultAppearance?: 'light' | 'dark' | 'system' // 默认外观模式
	statusCardsVisibility?: string // 状态卡片显示控制
	enableLogo?: boolean // 是否启用Logo
	logoUrl?: string // Logo图片URL
	enableTitle?: boolean // 是否启用标题
	titleText?: string // 标题文本
	enableSearchButton?: boolean // 是否启用搜索按钮
	enableAdminButton?: boolean // 是否启用管理员按钮
	enableStatsBar?: boolean // 是否启用统计栏
	enableGroupedBar?: boolean // 是否启用分组栏
	enableInstanceDetail?: boolean // 是否启用实例详情
	enablePingChart?: boolean // 是否启用延迟图表
	enableConnectBreaks?: boolean // 是否启用连接断点
	pingChartMaxPoints?: number // 延迟图表最大点数
	enableSwap?: boolean // 是否启用SWAP显示
	selectTrafficProgressStyle?: 'circular' | 'linear' // 流量进度条样式
	enableListItemProgressBar?: boolean // 是否启用列表视图进度条
	defaultCurrency?: string // 默认显示货币类型
	enableCurrencySymbol?: boolean // 是否显示货币符号
	currencyApi?: string // 汇率接口
	enableRemainingValueCalculation?: boolean // 是否启用剩余价值计算
	enableMonthlyRenewalCalculation?: boolean // 是否启用月续费统计栏
}

// 默认配置值
export const DEFAULT_CONFIG: ConfigOptions = {
	backgroundImage: '/assets/Moonlit-Scenery.webp',
	enableVideoBackground: false,
	videoBackgroundUrl: '/assets/LanternRivers_1080p15fps2Mbps3s.mp4',
	blurValue: 10,
	blurBackgroundColor: 'rgba(255, 255, 255, 0.5)|rgba(0, 0, 0, 0.5)',
	enableTransparentTags: true,
	tagDefaultColorList: 'ruby,gray,gold,bronze,brown,yellow,amber,orange,tomato,red',
	selectThemeColor: 'gray',
	enableLocalStorage: true,
	selectedDefaultView: 'grid',
	selectedDefaultAppearance: 'system',
	statusCardsVisibility: 'currentTime:true,currentOnline:true,regionOverview:true,trafficOverview:true,networkSpeed:true',
	enableLogo: false,
	logoUrl: '/assets/logo.png',
	enableTitle: true,
	titleText: 'Komari',
	enableSearchButton: true,
	enableAdminButton: true,
	enableStatsBar: true,
	enableGroupedBar: true,
	enableInstanceDetail: true,
	enablePingChart: true,
	enableConnectBreaks: false,
	pingChartMaxPoints: 0,
	enableSwap: true,
	selectTrafficProgressStyle: 'linear',
	enableListItemProgressBar: true,
	defaultCurrency: '人民币',
	enableCurrencySymbol: true,
	currencyApi: 'currency',
	enableRemainingValueCalculation: true,
	enableMonthlyRenewalCalculation: true
}
