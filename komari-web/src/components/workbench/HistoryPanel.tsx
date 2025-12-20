import React from 'react'
import type { HistoryItem } from '@/components/workbench/types'
import { statusColor } from '@/components/workbench/utils'
import { VscodeBadge, VscodeButton } from '@/components/workbench/VscodePanel'
import { RefreshCw } from 'lucide-react'

export const HistoryPanel = ({
	history,
	onRefresh,
	onSelectExec,
	onSelectItem,
	selected
}: {
	history: HistoryItem[]
	onRefresh: () => void
	onSelectExec: (execId: string) => void
	onSelectItem: (item: HistoryItem) => void
	selected: HistoryItem | null
}) => {
	const groups = Object.values(
		history.reduce<Record<string, HistoryItem[]>>((acc, item) => {
			if (!item.exec_id) return acc
			acc[item.exec_id] = acc[item.exec_id] || []
			acc[item.exec_id].push(item)
			return acc
		}, {})
	).sort((a, b) => {
		const ta = a[0]?.started_at ? new Date(a[0].started_at).getTime() : 0
		const tb = b[0]?.started_at ? new Date(b[0].started_at).getTime() : 0
		return tb - ta
	})

	return (
		<div className="h-full flex bg-white dark:bg-vscode-panel-background">
			<div className="flex-1 border-r border-gray-200 dark:border-vscode-border flex flex-col">
				<div className="flex justify-between items-center px-3 py-2 border-b border-gray-200 dark:border-vscode-border bg-gray-100 dark:bg-vscode-tabs-background flex-shrink-0">
					<span className="text-sm font-medium text-gray-800 dark:text-vscode-foreground">执行历史</span>
					<VscodeButton small icon={<RefreshCw size={14} />} onClick={onRefresh}>
						刷新
					</VscodeButton>
				</div>
				<div className="flex-1 overflow-y-auto p-3 space-y-2">
					{groups.map(items => {
						const execId = items[0].exec_id
						const started = items[0]?.started_at
						const duration = items[0]?.duration_ms
						const statusBadge = items.some(i => i.status === 'failed')
							? 'failed'
							: items.some(i => i.status === 'timeout')
							? 'timeout'
							: items.every(i => i.status === 'success')
							? 'success'
							: 'running'
						const isSelected = selected?.exec_id === execId
						return (
							<div
								key={execId}
								onClick={() => onSelectItem(items[0])}
								className={`border rounded p-2.5 cursor-pointer transition-colors ${
									isSelected
										? 'border-blue-500 dark:border-vscode-focus-border bg-blue-50 dark:bg-vscode-bg-light'
										: 'border-gray-300 dark:border-vscode-border hover:border-blue-500 dark:hover:border-vscode-focus-border'
								}`}>
								<div className="flex justify-between items-center mb-1">
									<span className="text-xs font-mono text-gray-500 dark:text-vscode-description-foreground">{execId}</span>
									<VscodeBadge color={statusColor(statusBadge)} variant="solid">
										{statusBadge}
									</VscodeBadge>
								</div>
								<div className="text-xs text-gray-500 dark:text-vscode-description-foreground mb-2">
									{started ? new Date(started).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}
									{duration ? ` · ${Math.round(duration / 1000)}s` : ''}
								</div>
								<div className="flex flex-wrap gap-1 mb-2">
									{items.slice(0, 3).map(it => (
										<VscodeBadge key={`${execId}-${it.client_uuid}`} color={statusColor(it.status)} variant="soft">
											{it.client_uuid?.substring(0, 8)}
										</VscodeBadge>
									))}
									{items.length > 3 && (
										<VscodeBadge color="gray" variant="soft">
											+{items.length - 3}
										</VscodeBadge>
									)}
								</div>
								<VscodeButton onClick={() => onSelectExec(execId)} className="w-full justify-center">
									查看日志
								</VscodeButton>
							</div>
						)
					})}
				</div>
			</div>
			<div className="w-96 flex flex-col bg-gray-50 dark:bg-vscode-bg-light">
				<div className="px-3 py-2 border-b border-gray-200 dark:border-vscode-border bg-gray-100 dark:bg-vscode-tabs-background flex-shrink-0">
					<span className="text-sm font-medium text-gray-800 dark:text-vscode-foreground">详细信息</span>
				</div>
				{selected ? (
					<div className="flex-1 overflow-y-auto p-3 space-y-3">
						<div className="space-y-2">
							<div>
								<div className="text-xs text-gray-500 dark:text-vscode-description-foreground">执行 ID</div>
								<div className="text-xs font-mono text-gray-800 dark:text-vscode-foreground">{selected.exec_id}</div>
							</div>
							<div>
								<div className="text-xs text-gray-500 dark:text-vscode-description-foreground">节点 UUID</div>
								<div className="text-xs font-mono text-gray-800 dark:text-vscode-foreground">{selected.client_uuid}</div>
							</div>
							<div>
								<div className="text-xs text-gray-500 dark:text-vscode-description-foreground">状态</div>
								<VscodeBadge color={statusColor(selected.status)} variant="solid">
									{selected.status}
								</VscodeBadge>
							</div>
							{selected.trigger_kind && (
								<div>
									<div className="text-xs text-gray-500 dark:text-vscode-description-foreground">触发类型</div>
									<div className="text-xs text-gray-800 dark:text-vscode-foreground">{selected.trigger_kind}</div>
								</div>
							)}
							{selected.duration_ms !== undefined && (
								<div>
									<div className="text-xs text-gray-500 dark:text-vscode-description-foreground">执行时长</div>
									<div className="text-xs text-gray-800 dark:text-vscode-foreground">{Math.round(selected.duration_ms / 1000)}s</div>
								</div>
							)}
						</div>
						{selected.error_log && (
							<div className="border border-red-500/50 dark:border-vscode-error-foreground/50 bg-red-50 dark:bg-vscode-error-foreground/10 rounded p-2">
								<div className="text-xs font-medium text-red-600 dark:text-vscode-error-foreground mb-1">错误日志</div>
								<div className="text-xs text-red-700 dark:text-vscode-error-foreground break-all font-mono">{selected.error_log}</div>
							</div>
						)}
						{selected.output && selected.output.length > 0 && (
							<div>
								<div className="text-xs font-medium text-gray-700 dark:text-vscode-foreground mb-2">输出日志</div>
								<div className="space-y-1.5 max-h-64 overflow-y-auto border border-gray-300 dark:border-vscode-border rounded p-2 bg-gray-100 dark:bg-vscode-bg-dark">
									{selected.output.map((o, idx) => (
										<div key={idx} className="text-xs font-mono">
											<div className="flex gap-2">
												<span className="text-gray-500 dark:text-vscode-description-foreground flex-shrink-0">
													{new Date(o.time).toLocaleTimeString()}
												</span>
												<span
													className={`flex-shrink-0 ${
														o.type === 'error' ? 'text-red-500 dark:text-vscode-error-foreground' : 'text-green-600 dark:text-green-400'
													}`}>
													[{o.type}]
												</span>
											</div>
											<div className="text-gray-800 dark:text-vscode-foreground break-words pl-2 mt-0.5">{o.content}</div>
										</div>
									))}
								</div>
							</div>
						)}
					</div>
				) : (
					<div className="flex flex-1 items-center justify-center">
						<span className="text-sm text-gray-400 dark:text-vscode-description-foreground">选择执行记录查看详情</span>
					</div>
				)}
			</div>
		</div>
	)
}
