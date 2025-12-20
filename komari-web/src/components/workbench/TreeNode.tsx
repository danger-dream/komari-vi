import { ChevronDown, ChevronRight, FileCode, FilePlus, Folder, FolderPlus, Trash2, Edit3 } from 'lucide-react'
import { Badge, Flex, Text } from '@radix-ui/themes'
import React from 'react'
import type { ScriptFolder, ScriptItem, TreeFolder } from '@/components/workbench/types'
import { VscodeBadge, VscodeButton } from '@/components/workbench/VscodePanel'

interface TreeNodeProps {
	node: TreeFolder
	activeId: number | null
	onSelect: (id: number) => void
	onAddFolder: (parent?: number | null) => void
	onAddScript: (folder?: number | null) => void
	onRenameFolder: (f: ScriptFolder) => void
	onDeleteFolder: (f: ScriptFolder) => void
	onRenameScript: (s: ScriptItem) => void
	onDeleteScript: (s: ScriptItem) => void
	setSelectedFolder: (id: number | null) => void
	expanded: boolean
	onToggle: (id: number) => void
	expandedSet: Set<number>
	isRoot?: boolean
	level?: number
}

export const TreeNode = ({
	node,
	activeId,
	onSelect,
	onAddFolder,
	onAddScript,
	onRenameFolder,
	onDeleteFolder,
	onRenameScript,
	onDeleteScript,
	setSelectedFolder,
	expanded,
	onToggle,
	expandedSet,
	isRoot = false,
	level = 0,
}: TreeNodeProps) => {
	const folderIdForAction = node.folder.id > 0 ? node.folder.id : null
	const indentStyle = { paddingLeft: `${level * 10 + 8}px` } // 10px per level + 8px base padding

	return (
		<div className="mt-1">
			<Flex
				align="center"
				className="group text-sm h-7 pr-1 rounded hover:bg-gray-200 dark:hover:bg-vscode-button-hover-background cursor-pointer"
				style={indentStyle}
				onClick={() => onToggle(node.folder.id)}>
				{expanded ? (
					<ChevronDown size={16} className="text-gray-600 dark:text-vscode-foreground" />
				) : (
					<ChevronRight size={16} className="text-gray-600 dark:text-vscode-foreground" />
				)}
				<Folder size={16} className="text-gray-500 dark:text-vscode-description-foreground mr-1" />
				<span
					className="flex-1 min-w-0 truncate text-gray-700 dark:text-vscode-foreground"
					onClick={e => {
						e.stopPropagation()
						setSelectedFolder(folderIdForAction)
					}}>
					{node.folder.name}
				</span>
				<div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
					<VscodeButton small icon={<FilePlus size={12} />} onClick={() => onAddScript(folderIdForAction ?? undefined)} title="新建脚本" />
					<VscodeButton small icon={<FolderPlus size={12} />} onClick={() => onAddFolder(folderIdForAction ?? undefined)} title="新建目录" />
					{!isRoot && (
						<>
							<VscodeButton small icon={<Edit3 size={12} />} onClick={() => onRenameFolder(node.folder)} title="重命名" />
							<VscodeButton small icon={<Trash2 size={12} />} onClick={() => onDeleteFolder(node.folder)} title="删除" />
						</>
					)}
				</div>
			</Flex>
			{expanded && (
				<div className="pl-4">
					{node.scripts.map(s => (
						<div
							key={s.id}
							onClick={() => onSelect(s.id)}
							className={`group h-7 px-2 pr-1 rounded cursor-pointer flex items-center gap-2 ${
								activeId === s.id
									? 'bg-blue-100 dark:bg-vscode-editor-selection-background text-gray-800 dark:text-vscode-foreground'
									: 'text-gray-700 dark:text-vscode-foreground hover:bg-gray-200 dark:hover:bg-vscode-button-hover-background'
							}`}
							style={{ paddingLeft: `${(level + 1) * 10 + 8}px` }}>
							<FileCode size={16} className="text-gray-500 dark:text-vscode-description-foreground" />
							<Text className="text-sm flex-1 min-w-0 truncate">{s.name}</Text>
							{!s.enabled && <VscodeBadge color="gray">停用</VscodeBadge>}
							<div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
								<VscodeButton
									small
									icon={<Edit3 size={12} />}
									onClick={e => {
										e.stopPropagation()
										onRenameScript(s)
									}}
									title="重命名"
								/>
								<VscodeButton
									small
									icon={<Trash2 size={12} />}
									onClick={e => {
										e.stopPropagation()
										onDeleteScript(s)
									}}
									title="删除"
								/>
							</div>
						</div>
					))}
					{node.children.map(child => (
						<TreeNode
							key={child.folder.id}
							node={child}
							activeId={activeId}
							onSelect={onSelect}
							onAddFolder={onAddFolder}
							onAddScript={onAddScript}
							onRenameFolder={onRenameFolder}
							onDeleteFolder={onDeleteFolder}
							onRenameScript={onRenameScript}
							onDeleteScript={onDeleteScript}
							setSelectedFolder={setSelectedFolder}
							expanded={expandedSet.has(child.folder.id)}
							onToggle={onToggle}
							expandedSet={expandedSet}
							isRoot={false}
							level={level + 1}
						/>
					))}
				</div>
			)}
		</div>
	)
}