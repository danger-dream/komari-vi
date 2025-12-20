import type { ScriptFolder, ScriptItem } from '@/components/workbench/types'
import { nilToNull } from '@/components/workbench/utils'
import { VscodeBadge, VscodeButton, VscodeInput, VscodeSelect, VscodeTextArea } from '@/components/workbench/VscodePanel'
import { FileCode, Folder } from 'lucide-react'

export const ConfigPanel = ({
	script,
	onChange,
	allScripts,
	allFolders,
	onPickClients
}: {
	script: ScriptItem | null
	onChange: (s: ScriptItem) => void
	allScripts: ScriptItem[]
	allFolders: ScriptFolder[]
	onPickClients: (s: ScriptItem) => void
}) => {
	if (!script) {
		return (
			<div className="h-full flex items-center justify-center text-gray-500 dark:text-vscode-description-foreground text-sm bg-white dark:bg-vscode-panel-background">
				选择脚本以查看配置
			</div>
		)
	}

	const triggerKind = script.trigger_kind || 'manual'

	return (
		<div className="h-full overflow-y-auto bg-white dark:bg-vscode-panel-background text-gray-800 dark:text-vscode-foreground">
			<div className="max-w-4xl mx-auto p-6 space-y-8">
				{/* General Section */}
				<div className="space-y-4">
					<h3 className="text-lg font-semibold border-b border-gray-200 dark:border-vscode-border pb-2">通用</h3>
					<div className="flex items-center justify-between py-2">
						<label htmlFor="scriptEnabled" className="text-sm font-medium text-gray-700 dark:text-vscode-foreground">
							启用此脚本
							<p className="text-xs text-gray-500 dark:text-vscode-description-foreground">禁用后将不会被定时或消息触发</p>
						</label>
						<input
							id="scriptEnabled"
							type="checkbox"
							checked={script.enabled}
							onChange={e => onChange({ ...script, enabled: e.target.checked })}
							className="h-4 w-4 rounded text-blue-600 bg-gray-100 border-gray-300 focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
						/>
					</div>
					<div className="flex items-center justify-between py-2">
						<label htmlFor="timeout" className="text-sm font-medium text-gray-700 dark:text-vscode-foreground">
							执行超时
						</label>
						<div className="flex items-center gap-2">
							<VscodeInput
								id="timeout"
								value={script.timeout_sec ?? 0}
								onChange={e => onChange({ ...script, timeout_sec: Number(e.target.value) })}
								type="number"
								min="0"
								className="w-28 text-right"
							/>
							<span className="text-sm text-gray-500 dark:text-vscode-description-foreground">秒 (0=不限制)</span>
						</div>
					</div>
				</div>

				{/* Trigger Section */}
				<div className="space-y-4">
					<h3 className="text-lg font-semibold border-b border-gray-200 dark:border-vscode-border pb-2">触发方式</h3>
					<div className="flex items-center justify-between py-2">
						<label htmlFor="triggerKind" className="text-sm font-medium text-gray-700 dark:text-vscode-foreground">
							触发类型
						</label>
						<VscodeSelect
							id="triggerKind"
							value={triggerKind}
							onChange={e => onChange({ ...script, trigger_kind: e.target.value })}
							className="w-48">
							<option value="manual">手动触发</option>
							<option value="cron">定时触发 (Cron)</option>
							<option value="message">消息触发</option>
						</VscodeSelect>
					</div>

					{triggerKind === 'cron' && (
						<div className="space-y-2 p-4 rounded-lg bg-gray-50 dark:bg-vscode-bg-light border border-gray-200 dark:border-vscode-border">
							<label htmlFor="cronExpr" className="text-sm font-medium text-gray-700 dark:text-vscode-foreground">
								Cron 表达式
							</label>
							<VscodeInput
								id="cronExpr"
								value={script.cron_expr || ''}
								onChange={e => onChange({ ...script, cron_expr: e.target.value })}
								placeholder="* * * * *"
								className="font-mono"
							/>
							<p className="text-xs text-gray-500 dark:text-vscode-description-foreground">
								使用标准 Cron 语法。例如 `0 */2 * * *` 表示每2小时。
							</p>
						</div>
					)}

					{triggerKind === 'message' && (
						<div className="space-y-2 p-4 rounded-lg bg-gray-50 dark:bg-vscode-bg-light border border-gray-200 dark:border-vscode-border">
							<label htmlFor="triggerName" className="text-sm font-medium text-gray-700 dark:text-vscode-foreground">
								消息名称
							</label>
							<VscodeInput
								id="triggerName"
								value={script.trigger_name || ''}
								onChange={e => onChange({ ...script, trigger_name: e.target.value })}
								placeholder="例如: user.login, order.created"
							/>
						</div>
					)}
				</div>

				{/* Target & Dependencies Section */}
				<div className="space-y-6">
					<h3 className="text-lg font-semibold border-b border-gray-200 dark:border-vscode-border pb-2">目标与依赖</h3>
					<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
						{/* Target Nodes */}
						<div className="space-y-3">
							<div className="flex items-center justify-between">
								<h4 className="text-sm font-semibold text-gray-800 dark:text-vscode-foreground">默认目标节点</h4>
								<VscodeButton onClick={() => onPickClients(script)}>选择</VscodeButton>
							</div>
							{script.clients && script.clients.length > 0 ? (
								<div className="p-3 bg-gray-100 dark:bg-vscode-bg-dark rounded-lg border border-gray-200 dark:border-vscode-border max-h-40 overflow-y-auto space-y-1">
									<p className="text-xs text-gray-500 dark:text-vscode-description-foreground mb-2">
										默认在 {script.clients.length} 个节点上运行
									</p>
									{script.clients.map((uuid, idx) => (
										<VscodeBadge key={idx} color="blue" variant="soft">
											{uuid}
										</VscodeBadge>
									))}
								</div>
							) : (
								<div className="p-4 bg-yellow-50 dark:bg-yellow-950/20 rounded-lg border border-yellow-200 dark:border-yellow-900 text-yellow-700 dark:text-yellow-300 text-xs">
									⚠️ 未绑定默认节点。
								</div>
							)}
						</div>
						{/* Dependencies */}
						<div className="space-y-3">
							<h4 className="text-sm font-semibold text-gray-800 dark:text-vscode-foreground">依赖项</h4>
							<div className="border border-gray-300 dark:border-vscode-border rounded-lg bg-white dark:bg-vscode-bg-dark overflow-hidden max-h-80">
								<div className="max-h-80 overflow-y-auto">
									<div className="divide-y divide-gray-200 dark:divide-vscode-border">
										{/* Depends on Scripts */}
										<div className="p-3">
											<label className="text-xs font-medium text-gray-600 dark:text-vscode-foreground">依赖脚本</label>
										</div>
										{allScripts.filter(s => s.id !== script.id).map(s => (
											<label
												key={`dep-s-${s.id}`}
												className="flex items-center gap-3 p-3 hover:bg-gray-100 dark:hover:bg-vscode-bg-light cursor-pointer transition-colors">
												<input
													type="checkbox"
													checked={script.depends_on_scripts?.includes(s.id) || false}
													onChange={e => {
														const exists = new Set(script.depends_on_scripts || [])
														if (e.target.checked) exists.add(s.id)
														else exists.delete(s.id)
														onChange({ ...script, depends_on_scripts: Array.from(exists) })
													}}
													className="w-4 h-4 rounded text-blue-600 bg-gray-100 border-gray-300 focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
												/>
												<FileCode size={16} className="text-gray-500 dark:text-vscode-description-foreground shrink-0" />
												<span className="flex-1 text-sm text-gray-700 dark:text-vscode-foreground truncate">{s.name}</span>
											</label>
										))}
										{/* Depends on Folders */}
										<div className="p-3 border-t border-gray-200 dark:border-vscode-border">
											<label className="text-xs font-medium text-gray-600 dark:text-vscode-foreground">依赖目录</label>
										</div>
										{allFolders.map(f => (
											<label
												key={`dep-f-${f.id}`}
												className="flex items-center gap-3 p-3 hover:bg-gray-100 dark:hover:bg-vscode-bg-light cursor-pointer transition-colors">
												<input
													type="checkbox"
													checked={script.depends_on_folders?.includes(f.id) || false}
													onChange={e => {
														const exists = new Set(script.depends_on_folders || [])
														if (e.target.checked) exists.add(f.id)
														else exists.delete(f.id)
														onChange({ ...script, depends_on_folders: Array.from(exists) })
													}}
													className="w-4 h-4 rounded text-blue-600 bg-gray-100 border-gray-300 focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
												/>
												<Folder size={16} className="text-gray-500 dark:text-vscode-description-foreground shrink-0" />
												<span className="flex-1 text-sm text-gray-700 dark:text-vscode-foreground truncate">{f.name}</span>
											</label>
										))}
									</div>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	)
}
