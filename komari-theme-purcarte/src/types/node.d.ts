export interface NodeData {
	uuid: string
	name: string
	cpu_name: string
	virtualization: string
	arch: string
	cpu_cores: number
	os: string
	gpu_name: string
	region: string
	mem_total: number
	swap_total: number
	disk_total: number
	weight: number
	price: number
	billing_cycle: number
	currency: string
	expired_at: string | null
	group: string
	tags: string
	traffic_limit?: number
	traffic_limit_type?: 'sum' | 'max' | 'min' | 'up' | 'down'
	created_at: string
	updated_at: string
}

export interface NodeStats {
	cpu: { usage: number }
	ram: { total: number; used: number }
	swap: { total: number; used: number }
	disk: { total: number; used: number }
	network: { up: number; down: number; totalUp: number; totalDown: number }
	load: { load1: number; load5: number; load15: number }
	uptime: number
	process: number
	connections: { tcp: number; udp: number }
	message: string
	updated_at: string
}

export interface NodeWithStatus extends NodeData {
	status: 'online' | 'offline'
	stats?: NodeStats
}

export interface ApiResponse<T> {
	status: 'success' | 'error'
	message: string
	data: T
}

export interface PublicInfo {
	allow_cors: boolean
	custom_body: string
	custom_head: string
	description: string
	disable_password_login: boolean
	oauth_enable: boolean
	ping_record_preserve_time: number
	sp_record_preserve_hours?: number
	sp_chart_ranges?: string | string[]
	record_enabled: boolean
	record_preserve_time: number
	sitename: string
	theme_settings: object | null
}

export interface HistoryRecord {
	client: string
	time: string
	cpu: number
	gpu: number
	ram: number
	ram_total: number
	swap: number
	swap_total: number
	load: number
	temp: number
	disk: number
	disk_total: number
	net_in: number
	net_out: number
	net_total_up: number
	net_total_down: number
	process: number
	connections: number
	connections_udp: number
}

export interface PingHistoryRecord {
	task_id: number
	time: string
	value: number
	client?: string
}

export interface PingTask {
	id: number
	interval: number
	name: string
	loss?: number
	type?: string
	target?: string
	clients?: string[]
	min?: number
	max?: number
	avg?: number
	total?: number
}

export interface PingClientBasicInfo {
	client: string
	loss: number
	min: number
	max: number
}

export interface PingHistoryResponse {
	count: number
	records: PingHistoryRecord[]
	tasks: PingTask[]
	basic_info?: PingClientBasicInfo[]
}

export type TaskPingHistoryResponse = PingHistoryResponse

export interface SPPingRecord {
	task_id: number
	time: string
	median: number
	min: number
	max: number
	p10: number
	p90: number
	loss: number
	total: number
	samples?: number[]
}

export interface SPPingTask {
	id: number
	name: string
	type: string
	step: number
	pings: number
	timeoutMs?: number
	bucket?: number
	loss?: number
	min?: number
	max?: number
	latest?: number
	median?: number
	p10?: number
	p90?: number
}

export interface SPPingHistoryResponse {
	count: number
	records: SPPingRecord[]
	tasks: SPPingTask[]
	from?: string
	to?: string
}
