export interface ScriptFolder {
	id: number
	name: string
	parent_id?: number | null
	icon?: string
	order?: number
	created_at?: string
	updated_at?: string
}

export interface ScriptItem {
	id: number
	name: string
	folder_id?: number | null
	order?: number
	enabled: boolean
	clients?: string[]
	client_status?: ClientStatusEntry[]
	script_body: string
	timeout_sec?: number
	trigger_kind?: string
	cron_expr?: string
	trigger_name?: string
	message_type?: string
	depends_on_scripts?: number[]
	depends_on_folders?: number[]
	created_at?: string
	updated_at?: string
}

export interface ClientStatusEntry {
	client_id: string
	exec_id: string
	dispatch_status: string // e.g., "dispatched", "offline"
	exec_status: string // e.g., "running", "success", "failed", "timeout"
	error_log?: string
	updated_at: string
}

export interface HistoryLogEntry {
	time: string
	type: string
	content: string
}

export interface HistoryItem {
	id: number
	script_id: number
	exec_id: string
	client_uuid: string
	status: string
	trigger_kind?: string
	trigger_name?: string
	started_at?: string
	finished_at?: string
	duration_ms?: number
	output?: HistoryLogEntry[]
	error_log?: string
	created_at?: string
	updated_at?: string
}

export interface VariableItem {
	id: number
	scope: string
	script_id?: number
	client_uuid?: string
	key: string
	value: string
	value_type: string
	created_by_client?: string
	updated_by_client?: string
	updated_at?: string
}

export interface LogLine {
	script_id: number
	exec_id: string
	time: string
	level: string
	message: string
	client_uuid?: string
}

export interface TreeFolder {
	folder: ScriptFolder
	scripts: ScriptItem[]
	children: TreeFolder[]
}
