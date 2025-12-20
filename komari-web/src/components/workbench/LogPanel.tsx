import { Checkbox } from '@radix-ui/themes'
import { RefreshCw } from 'lucide-react'
import React from 'react'
import type { LogLine } from '@/components/workbench/types'
import { VscodeButton, VscodeSelect } from '@/components/workbench/VscodePanel'

export const LogPanel = ({
	logs,
	currentExecId,
	autoScroll,
	onToggleAutoScroll,
	onClear,
	execOptions,
	onSelectExec,
	endRef
}: {
	logs: LogLine[]
	currentExecId: string
	autoScroll: boolean
	onToggleAutoScroll: (v: boolean) => void
	onClear: () => void
	execOptions: string[]
	onSelectExec: (execId: string) => void
	endRef: React.RefObject<HTMLDivElement | null>
}) => (
	<div className="h-full flex flex-col bg-white dark:bg-vscode-panel-background">
		<div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-vscode-border bg-gray-100 dark:bg-vscode-tabs-background flex-shrink-0">
			<div className="flex items-center gap-2">
				<span className="text-xs text-gray-500 dark:text-vscode-description-foreground">执行:</span>
				<VscodeSelect
					value={currentExecId}
					onChange={e => onSelectExec(e.target.value)}
					className="text-xs min-w-[200px]"
				>
					<option value="">未选择</option>
					{execOptions.map(id => (
						<option key={id} value={id}>
							{id}
						</option>
					))}
				</VscodeSelect>
			</div>
			<div className="flex items-center gap-2">
				<label className="flex items-center gap-1.5 cursor-pointer text-xs text-gray-500 dark:text-vscode-description-foreground">
					<input
						type="checkbox"
						checked={autoScroll}
						onChange={e => onToggleAutoScroll(e.target.checked)}
						className="w-3.5 h-3.5 rounded text-blue-600 bg-gray-100 border-gray-300 focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
					/>
					自动滚动
				</label>
				<VscodeButton small icon={<RefreshCw size={12} />} onClick={onClear}>
					清空
				</VscodeButton>
			</div>
		</div>
		<div className="flex-1 overflow-y-auto p-3 font-mono text-xs text-gray-800 dark:text-vscode-foreground bg-white dark:bg-vscode-editor-background">
			<div className="space-y-1">
				{logs.map((l, idx) => (
					<div key={`${l.exec_id}-${idx}`} className="flex gap-2 leading-relaxed">
						<span className="text-gray-500 dark:text-vscode-description-foreground flex-shrink-0 w-20">{new Date(l.time).toLocaleTimeString()}</span>
						<span
							className={`flex-shrink-0 w-12 ${
								l.level === 'error' ? 'text-red-500 dark:text-vscode-error-foreground' : 'text-green-500 dark:text-green-400'
							}`}>
							[{l.level || 'info'}]
						</span>
						<span className="flex-1 text-gray-800 dark:text-vscode-foreground break-words">{l.message}</span>
						{l.client_uuid && <span className="text-gray-400 dark:text-vscode-description-foreground flex-shrink-0 text-[10px]">#{l.client_uuid.substring(0, 8)}</span>}
					</div>
				))}
				<div ref={endRef} />
			</div>
		</div>
	</div>
)
