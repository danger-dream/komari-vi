import React from 'react'
import type { VariableItem } from '@/components/workbench/types'
import { VscodeBadge, VscodeButton, VscodeInput, VscodeSelect } from '@/components/workbench/VscodePanel'
import { Edit3, Plus, Trash2 } from 'lucide-react'

export const VariablePanel = ({
	scope,
	onScopeChange,
	nodeFilter,
	onNodeChange,
	variables,
	onAdd,
	onDelete,
	onEdit
}: {
	scope: 'script' | 'node' | 'global'
	onScopeChange: (v: 'script' | 'node' | 'global') => void
	nodeFilter: string
	onNodeChange: (v: string) => void
	variables: VariableItem[]
	onAdd: () => void
	onDelete: (id: number) => void
	onEdit: (item: VariableItem) => void
}) => (
	<div className="h-full flex flex-col bg-white dark:bg-vscode-panel-background">
		<div className="flex items-center gap-3 px-3 py-2 border-b border-gray-200 dark:border-vscode-border bg-gray-100 dark:bg-vscode-tabs-background flex-shrink-0">
			<label className="text-xs text-gray-700 dark:text-vscode-foreground font-medium">作用域:</label>
			<VscodeSelect
				value={scope}
				onChange={e => onScopeChange(e.target.value as any)}
				className="text-xs"
			>
				<option value="script">Script</option>
				<option value="node">Node</option>
				<option value="global">Global</option>
			</VscodeSelect>
			{scope === 'node' && (
				<VscodeInput
					value={nodeFilter}
					onChange={e => onNodeChange(e.target.value)}
					placeholder="节点 UUID 筛选"
					className="flex-1 max-w-xs text-xs"
				/>
			)}
			<div className="flex-1" />
			<VscodeButton small icon={<Plus size={14} />} onClick={onAdd}>
				新增
			</VscodeButton>
		</div>
		<div className="flex-1 overflow-y-auto p-3">
			{variables.length === 0 ? (
				<div className="h-full flex items-center justify-center">
					<span className="text-sm text-gray-500 dark:text-vscode-description-foreground">暂无变量</span>
				</div>
			) : (
				<div className="space-y-2">
					{variables.map(v => (
						<div
							key={v.id}
							className="border border-gray-300 dark:border-vscode-border rounded p-3 hover:border-blue-500 dark:hover:border-vscode-focus-border transition-colors bg-white dark:bg-vscode-bg-light">
							<div className="flex justify-between items-start mb-2">
								<div className="flex-1 min-w-0">
									<span className="text-sm font-medium text-gray-800 dark:text-vscode-foreground">{v.key}</span>
									<VscodeBadge color="gray" variant="soft" className="ml-2">
										{v.value_type}
									</VscodeBadge>
								</div>
								<div className="flex gap-1 flex-shrink-0 ml-2">
									<VscodeButton small icon={<Edit3 size={14} />} onClick={() => onEdit(v)} title="编辑" />
									<VscodeButton small icon={<Trash2 size={14} />} onClick={() => onDelete(v.id)} title="删除" />
								</div>
							</div>
							<div className="bg-gray-100 dark:bg-vscode-bg-dark border border-gray-200 dark:border-vscode-border rounded p-2 mb-2">
								<span className="text-xs font-mono text-gray-700 dark:text-vscode-foreground break-all">{v.value}</span>
							</div>
							<div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-500 dark:text-vscode-description-foreground">
								<span>作用域: {v.scope}</span>
								{v.script_id !== undefined && <span>脚本 ID: {v.script_id ?? '-'}</span>}
								{v.client_uuid && <span>节点: {v.client_uuid.substring(0, 8)}</span>}
								{v.updated_at && <span>更新: {new Date(v.updated_at).toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' })}</span>}
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	</div>
)
