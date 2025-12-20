import React, { forwardRef, useCallback, useEffect, useMemo, useRef, useState, useContext, createContext } from 'react'
import { Badge, Button, Dialog, Flex, SegmentedControl, Text, TextArea, TextField, Tooltip } from '@radix-ui/themes'
import { useTranslation } from 'react-i18next'
import {
	FolderTree,
	ListTree,
	EyeOff,
	Maximize2,
	MonitorDot,
	RefreshCw,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	Plus,
	Pencil,
	Trash2,
	Search,
	TerminalSquare,
	X
} from 'lucide-react'
import { Terminal as XTerm } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { WebLinksAddon } from 'xterm-addon-web-links'
import { SearchAddon } from 'xterm-addon-search'
import Loading from '@/components/loading'
import { NodeDetailsProvider, useNodeDetails, type NodeDetail } from '@/contexts/NodeDetailsContext'
import { LiveDataProvider, useLiveData } from '@/contexts/LiveDataContext'
import Flag from '@/components/Flag'
import { CommandClipboardProvider, useCommandClipboard, type CommandClipboard } from '@/contexts/CommandClipboardContext'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import 'xterm/css/xterm.css'
import '../terminal/Terminal.css'
import './TerminalHub.css'

type SessionStatus = 'connecting' | 'open' | 'closed' | 'offline'

type SessionTab = {
	uuid: string
	name: string
	group?: string
	status: SessionStatus
}

type SessionRowProps = {
	node: NodeDetail
	active: boolean
	online: boolean
	onDoubleClick: () => void
	onSelect: () => void
}

const PrivacyContext = createContext<{ privacyMode: boolean }>({ privacyMode: false })
const ConnectionContext = createContext<{
	registerSocket: (ws: WebSocket) => void
	unregisterSocket: (ws: WebSocket) => void
}>({
	registerSocket: () => {},
	unregisterSocket: () => {}
})
const SenderContext = createContext<{
	registerSender: (uuid: string, sender: (cmd: string) => void) => void
	unregisterSender: (uuid: string) => void
	sendTo: (uuid: string, cmd: string) => void
}>({
	registerSender: () => {},
	unregisterSender: () => {},
	sendTo: () => {}
})

const CommandPanel = ({ activeTab, onSend, height }: { activeTab: string | null; onSend: (cmd: string) => void; height?: number }) => {
	const { commands, loading, error, addCommand, updateCommand, deleteCommand, refresh } = useCommandClipboard()
	const [t] = useTranslation()
	const [dialogOpen, setDialogOpen] = useState(false)
	const [dialogMode, setDialogMode] = useState<'add' | 'edit'>('add')
	const [editingCommand, setEditingCommand] = useState<CommandClipboard | null>(null)
	const [saving, setSaving] = useState(false)
	const [formState, setFormState] = useState({
		name: '',
		text: ''
	})
	const [orderedCommands, setOrderedCommands] = useState<CommandClipboard[]>([])
	const [commandMenu, setCommandMenu] = useState<{
		open: boolean
		x: number
		y: number
		command: CommandClipboard | null
	}>({ open: false, x: 0, y: 0, command: null })
	const [draggingId, setDraggingId] = useState<number | null>(null)
	const [dragOverId, setDragOverId] = useState<number | null>(null)

	useEffect(() => {
		const sortedList = [...(commands || [])].sort((a, b) => {
			if (a.weight !== b.weight) return a.weight - b.weight
			return a.name.localeCompare(b.name, 'zh-Hans', { sensitivity: 'base' })
		})
		setOrderedCommands(sortedList)
	}, [commands])

	const openDialog = (cmd?: CommandClipboard) => {
		setDialogMode(cmd ? 'edit' : 'add')
		setEditingCommand(cmd ?? null)
		setFormState({
			name: cmd?.name ?? '',
			text: cmd?.text ?? ''
		})
		setDialogOpen(true)
	}

	const handleDelete = async (cmd: CommandClipboard) => {
		if (!window.confirm(t('terminal.command_confirm_delete', '确认删除这条命令吗？'))) return
		await deleteCommand(cmd.id)
		refresh()
	}

	const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		const name = formState.name.trim()
		const text = formState.text.trim()
		if (!name || !text) {
			toast.error(t('terminal.command_required', '请填写命令名称与命令内容'))
			return
		}
		setSaving(true)
		try {
			if (dialogMode === 'edit' && editingCommand) {
				await updateCommand(editingCommand.id, name, text, editingCommand.remark ?? '', editingCommand.weight ?? 0)
				toast.success(t('terminal.command_updated', '命令已更新'))
			} else {
				const nextWeight = orderedCommands.length > 0 ? Math.max(...orderedCommands.map(c => c.weight ?? 0)) + 1 : 0
				await addCommand(name, text, '', nextWeight)
				toast.success(t('terminal.command_saved', '命令已添加'))
			}
			await refresh()
			setDialogOpen(false)
		} catch (err) {
			toast.error(err instanceof Error ? err.message : t('common.request_error', '操作失败，请稍后重试'))
		} finally {
			setSaving(false)
		}
	}

	const handleDrop = async (targetId: number) => {
		if (draggingId === null || draggingId === targetId) return
		const current = [...orderedCommands]
		const fromIndex = current.findIndex(c => c.id === draggingId)
		const toIndex = current.findIndex(c => c.id === targetId)
		if (fromIndex === -1 || toIndex === -1) return
		const [moved] = current.splice(fromIndex, 1)
		current.splice(toIndex, 0, moved)
		const withWeights = current.map((cmd, idx) => ({ ...cmd, weight: idx }))
		setOrderedCommands(withWeights)
		setDraggingId(null)
		setDragOverId(null)
		try {
			const changed = withWeights.filter((cmd, idx) => cmd.weight !== (commands?.find(c => c.id === cmd.id)?.weight ?? idx))
			await Promise.all(changed.map(cmd => updateCommand(cmd.id, cmd.name, cmd.text, cmd.remark ?? '', cmd.weight ?? 0)))
			await refresh()
			toast.success(t('terminal.command_reordered', '排序已更新'))
		} catch (err) {
			toast.error(err instanceof Error ? err.message : t('common.request_error', '排序失败，请稍后重试'))
			refresh()
		}
	}

	useEffect(() => {
		const hideMenu = () => setCommandMenu(m => ({ ...m, open: false, command: null }))
		const handleKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') hideMenu()
		}
		document.addEventListener('mousedown', hideMenu)
		document.addEventListener('keydown', handleKey)
		return () => {
			document.removeEventListener('mousedown', hideMenu)
			document.removeEventListener('keydown', handleKey)
		}
	}, [])

	return (
		<div className="xshell-command-panel" style={height ? { height } : undefined}>
			<div className="xshell-command-header">
				<div className="xshell-command-text">
					<Text size="2" weight="bold">
						{t('terminal.command_panel', '命令面板')}
					</Text>
					<Text size="1" color="gray">
						{activeTab ? t('terminal.command_hint', '点击命令将发送到当前终端') : t('terminal.no_active_connection')}
					</Text>
				</div>
				<div className="xshell-command-actions">
					<Button size="1" variant="soft" className="xshell-command-btn xshell-command-btn-primary" onClick={() => openDialog()}>
						<Plus size={14} />
						{t('terminal.command_add', '新增命令')}
					</Button>
					<Button size="1" variant="ghost" className="xshell-command-btn xshell-command-btn-secondary" onClick={refresh} disabled={loading}>
						<RefreshCw size={14} />
						{t('common.refresh', '刷新')}
					</Button>
				</div>
			</div>
			<div className="xshell-command-body">
				{loading && <Text size="1">{t('common.loading', '加载中…')}</Text>}
				{error && (
					<Text size="1" color="red">
						{error.message}
					</Text>
				)}
				{!loading && !error && orderedCommands.length === 0 && (
					<Text size="1" color="gray">
						{t('terminal.command_empty', '暂无常用命令')}
					</Text>
				)}
				<div className="xshell-command-grid">
					{orderedCommands.map(cmd => (
						<button
							key={cmd.id}
							className={`xshell-command-chip ${draggingId === cmd.id ? 'dragging' : ''} ${dragOverId === cmd.id ? 'drag-over' : ''}`}
							onClick={() => onSend(cmd.text)}
							disabled={!activeTab}
							title={cmd.name}
							draggable
							onDragStart={() => {
								setDraggingId(cmd.id)
								setCommandMenu(m => ({ ...m, open: false }))
							}}
							onDragOver={e => {
								e.preventDefault()
								if (dragOverId !== cmd.id) setDragOverId(cmd.id)
							}}
							onDragEnd={() => {
								setDraggingId(null)
								setDragOverId(null)
							}}
							onDrop={e => {
								e.preventDefault()
								handleDrop(cmd.id)
							}}
							onContextMenu={e => {
								e.preventDefault()
								e.stopPropagation()
								setCommandMenu({
									open: true,
									x: e.clientX,
									y: e.clientY,
									command: cmd
								})
							}}>
							<span className="name">{cmd.name || t('common.command', '命令')}</span>
						</button>
					))}
				</div>
			</div>
			{commandMenu.open && commandMenu.command && (
				<div className="xshell-command-menu" style={{ top: commandMenu.y, left: commandMenu.x }} onMouseDown={e => e.stopPropagation()}>
					<button
						onClick={() => {
							openDialog(commandMenu.command!)
							setCommandMenu(m => ({ ...m, open: false }))
						}}>
						<Pencil size={12} />
						{t('common.edit', '编辑')}
					</button>
					<button
						onClick={() => {
							handleDelete(commandMenu.command!)
							setCommandMenu(m => ({ ...m, open: false }))
						}}>
						<Trash2 size={12} />
						{t('common.delete', '删除')}
					</button>
				</div>
			)}
			<Dialog.Root
				open={dialogOpen}
				onOpenChange={open => {
					setDialogOpen(open)
					if (!open) {
						setEditingCommand(null)
						setSaving(false)
					}
				}}>
				<Dialog.Content className="xshell-command-dialog" maxWidth="520px">
					<Dialog.Title>{dialogMode === 'edit' ? t('common.edit', '编辑命令') : t('common.add', '新增命令')}</Dialog.Title>
					<Dialog.Description size="2" color="gray">
						{dialogMode === 'edit'
							? t('terminal.command_edit_desc', '更新命令文案后保存。')
							: t('terminal.command_add_desc', '填写常用命令并保存，列表可一键下发到终端。')}
					</Dialog.Description>
					<form className="xshell-command-form" onSubmit={handleSubmit}>
						<div className="xshell-command-field">
							<label htmlFor="cmd-name">
								{t('common.name', '命令名称')}
								<span className="xshell-required">*</span>
							</label>
							<TextField.Root
								id="cmd-name"
								value={formState.name}
								onChange={e =>
									setFormState(s => ({
										...s,
										name: e.target.value
									}))
								}
								placeholder={t('terminal.command_add_name', '请输入命令名称')}
								autoComplete="off"
								required
							/>
						</div>
						<div className="xshell-command-field">
							<label htmlFor="cmd-text">
								{t('common.content', '命令内容')}
								<span className="xshell-required">*</span>
							</label>
							<TextArea
								id="cmd-text"
								rows={5}
								value={formState.text}
								onChange={e =>
									setFormState(s => ({
										...s,
										text: e.target.value
									}))
								}
								placeholder={t('terminal.command_add_text', '支持多行命令，按顺序执行')}
								required
							/>
						</div>
						<Flex justify="end" gap="3" mt="2">
							<Dialog.Close>
								<Button variant="soft" type="button">
									{t('common.cancel', '取消')}
								</Button>
							</Dialog.Close>
							<Button type="submit" disabled={saving} className="xshell-command-btn xshell-command-btn-primary">
								{dialogMode === 'edit' ? t('common.save', '保存修改') : t('common.add', '添加')}
							</Button>
						</Flex>
					</form>
				</Dialog.Content>
			</Dialog.Root>
		</div>
	)
}
const TerminalWorkbenchPage = () => (
	<LiveDataProvider>
		<NodeDetailsProvider>
			<CommandClipboardProvider>
				<TerminalWorkbench />
			</CommandClipboardProvider>
		</NodeDetailsProvider>
	</LiveDataProvider>
)

const TerminalWorkbench = () => {
	const { nodeDetail, isLoading, error, refresh } = useNodeDetails()
	const { live_data } = useLiveData()
	const [t] = useTranslation()
	const [searchTerm, setSearchTerm] = useState('')
	const [viewMode, setViewMode] = useState<'list' | 'group'>('list')
	const [tabs, setTabs] = useState<SessionTab[]>([])
	const [activeTab, setActiveTab] = useState<string | null>(null)
	const [focusedNode, setFocusedNode] = useState<string | null>(null)
	const [fullscreen, setFullscreen] = useState(false)
	const [privacyMode, setPrivacyMode] = useState(false)
	const [showCommands, setShowCommands] = useState(false)
	const [tabMenu, setTabMenu] = useState<{
		open: boolean
		x: number
		y: number
		tabId: string | null
	}>({ open: false, x: 0, y: 0, tabId: null })
	const defaultGroupLabel = t('terminal.ungrouped', '未分组')
	const nodeRefs = useRef<Map<string, HTMLDivElement>>(new Map())
	const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
	const tabListRef = useRef<HTMLDivElement | null>(null)
	const tabListScroll = useRef<{ left: number; width: number }>({ left: 0, width: 0 })
	const socketSetRef = useRef<Set<WebSocket>>(new Set())
	const senderMapRef = useRef<Map<string, (cmd: string) => void>>(new Map())
	const contentRef = useRef<HTMLDivElement | null>(null)
	const [commandHeight, setCommandHeight] = useState(200)
	const dragStateRef = useRef<{ y: number; height: number } | null>(null)

	const onlineSet = useMemo(() => new Set(live_data?.data?.online ?? []), [live_data])

	useEffect(() => {
		const originalOverflow = document.body.style.overflow
		if (fullscreen) {
			document.body.style.overflow = 'hidden'
		}
		return () => {
			document.body.style.overflow = originalOverflow
		}
	}, [fullscreen])

	const nodeComparator = useCallback(
		(a: NodeDetail, b: NodeDetail) => {
			const onlineA = onlineSet.has(a.uuid)
			const onlineB = onlineSet.has(b.uuid)
			if (onlineA !== onlineB) return onlineA ? -1 : 1 // 在线优先
			if (a.weight !== undefined && b.weight !== undefined && a.weight !== b.weight) {
				return a.weight - b.weight
			}
			const nameCompare = a.name.localeCompare(b.name, 'zh-Hans', {
				sensitivity: 'base',
				numeric: true
			})
			if (nameCompare !== 0) return nameCompare
			return a.uuid.localeCompare(b.uuid)
		},
		[onlineSet]
	)

	const sortedNodes = useMemo(() => {
		return [...(nodeDetail || [])].sort(nodeComparator)
	}, [nodeComparator, nodeDetail])

	const filteredNodes = useMemo(() => sortedNodes.filter(node => node.name.toLowerCase().includes(searchTerm.toLowerCase())), [sortedNodes, searchTerm])

	const groupedNodes = useMemo(() => {
		const groups = new Map<string, NodeDetail[]>()
		filteredNodes.forEach(node => {
			const key = node.group || defaultGroupLabel
			if (!groups.has(key)) groups.set(key, [])
			groups.get(key)!.push(node)
		})
		return Array.from(groups.entries())
			.sort(([a], [b]) => {
				const aIsDefault = a === defaultGroupLabel
				const bIsDefault = b === defaultGroupLabel
				if (aIsDefault && !bIsDefault) return 1 // 默认分组放最后
				if (!aIsDefault && bIsDefault) return -1
				return a.localeCompare(b, 'zh-Hans', { sensitivity: 'base' })
			})
			.map(([groupName, nodes]) => [groupName, nodes.sort(nodeComparator)] as [string, NodeDetail[]])
	}, [defaultGroupLabel, filteredNodes, nodeComparator])

	const ensureActiveTab = useCallback(
		(uuid: string) => {
			const targetNode = filteredNodes.find(node => node.uuid === uuid)
			setTabs(prev => {
				const exists = prev.find(tab => tab.uuid === uuid)
				if (exists) return prev
				return [
					...prev,
					{
						uuid,
						name: targetNode?.name || t('terminal.title'),
						group: targetNode?.group,
						status: onlineSet.has(uuid) ? 'connecting' : 'offline'
					}
				]
			})
			setActiveTab(uuid)
		},
		[filteredNodes, onlineSet, t]
	)

	const handleOpenNode = (node: NodeDetail) => {
		setFocusedNode(node.uuid)
		ensureActiveTab(node.uuid)
	}

	const handleCloseTab = (uuid: string) => {
		setTabs(prev => {
			const idx = prev.findIndex(tab => tab.uuid === uuid)
			if (idx === -1) return prev
			const nextTabs = prev.filter(tab => tab.uuid !== uuid)
			setActiveTab(current => {
				if (current && current !== uuid) return current
				if (!nextTabs.length) return null
				const pick = nextTabs[Math.max(0, idx - 1)] ?? nextTabs[0]
				return pick.uuid
			})
			return nextTabs
		})
	}

	const handleCloseLeft = (uuid: string) => {
		setTabs(prev => {
			const idx = prev.findIndex(tab => tab.uuid === uuid)
			if (idx <= 0) return prev
			const nextTabs = prev.slice(idx)
			setActiveTab(current => {
				if (!current) return current
				const stillThere = nextTabs.find(t => t.uuid === current)
				if (stillThere) return current
				return nextTabs[0]?.uuid ?? null
			})
			return nextTabs
		})
	}

	const handleCloseRight = (uuid: string) => {
		setTabs(prev => {
			const idx = prev.findIndex(tab => tab.uuid === uuid)
			if (idx === -1 || idx === prev.length - 1) return prev
			const nextTabs = prev.slice(0, idx + 1)
			setActiveTab(current => {
				if (!current) return current
				const stillThere = nextTabs.find(t => t.uuid === current)
				if (stillThere) return current
				return nextTabs[nextTabs.length - 1]?.uuid ?? null
			})
			return nextTabs
		})
	}

	const handleCloseAll = () => {
		setTabs([])
		setActiveTab(null)
	}

	const handleStatusChange = useCallback((uuid: string, status: SessionStatus) => {
		setTabs(prev =>
			prev.map(tab =>
				tab.uuid === uuid
					? {
							...tab,
							status
					  }
					: tab
			)
		)
	}, [])

	useEffect(() => {
		const closeAllSockets = () => {
			socketSetRef.current.forEach(ws => {
				try {
					ws.close()
				} catch {
					/* ignore */
				}
			})
			socketSetRef.current.clear()
		}
		window.addEventListener('beforeunload', closeAllSockets)
		return () => {
			window.removeEventListener('beforeunload', closeAllSockets)
			closeAllSockets()
		}
	}, [])

	useEffect(() => {
		if (!activeTab && tabs.length) {
			setActiveTab(tabs[tabs.length - 1].uuid)
		}
	}, [activeTab, tabs])

	useEffect(() => {
		setTabs(prev =>
			prev.map(tab => {
				const online = onlineSet.has(tab.uuid)
				if (tab.status === 'open' || tab.status === 'connecting') return tab
				return {
					...tab,
					status: online ? 'connecting' : 'offline'
				}
			})
		)
	}, [onlineSet])

	useEffect(() => {
		const handleMenuHide = () => setTabMenu(m => ({ ...m, open: false }))
		const handleKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') handleMenuHide()
		}
		document.addEventListener('mousedown', handleMenuHide)
		document.addEventListener('keydown', handleKey)
		return () => {
			document.removeEventListener('mousedown', handleMenuHide)
			document.removeEventListener('keydown', handleKey)
		}
	}, [])

	const handleTabWheel = useCallback((e: React.WheelEvent) => {
		if (!tabListRef.current) return
		e.preventDefault()
		e.stopPropagation()
		const deltaRaw = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX
		const delta = Math.abs(deltaRaw) > 0 ? deltaRaw : e.deltaY || e.deltaX
		tabListRef.current.scrollLeft += delta
		tabListScroll.current = {
			left: tabListRef.current.scrollLeft,
			width: tabListRef.current.scrollWidth
		}
	}, [])

	useEffect(() => {
		if (!activeTab) return
		const target = nodeRefs.current.get(activeTab)
		if (target) {
			target.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
		}
	}, [activeTab])
	useEffect(() => {
		if (!activeTab) return
		const target = tabRefs.current.get(activeTab)
		if (target) {
			target.scrollIntoView({ behavior: 'smooth', inline: 'nearest' })
		}
	}, [activeTab])

	if (isLoading) return <Loading />
	if (error) return <div className="text-red-500">{error || 'Failed to load nodes'}</div>

	return (
		<ConnectionContext.Provider
			value={{
				registerSocket: ws => socketSetRef.current.add(ws),
				unregisterSocket: ws => socketSetRef.current.delete(ws)
			}}>
			<SenderContext.Provider
				value={{
					registerSender: (uuid, sender) => senderMapRef.current.set(uuid, sender),
					unregisterSender: uuid => senderMapRef.current.delete(uuid),
					sendTo: (uuid, cmd) => senderMapRef.current.get(uuid)?.(cmd)
				}}>
				<PrivacyContext.Provider value={{ privacyMode }}>
					<div className={`xshell-container ${fullscreen ? 'xshell-fullscreen' : ''}`}>
						<div className="xshell-sidebar">
							<div className="xshell-toolbar">
								<div className="xshell-title-row">
									<TerminalSquare size={18} />
									<div className="flex items-baseline gap-2">
										<Text weight="bold" className="xshell-title">
											{t('terminal.title')}
										</Text>
									</div>
								</div>
								<div className="xshell-actions">
									<Tooltip content={privacyMode ? t('terminal.privacy_off', '关闭隐私模式') : t('terminal.privacy_on', '开启隐私模式')}>
										<Button size="1" variant="ghost" color="indigo" onClick={() => setPrivacyMode(s => !s)} className="xshell-icon-btn">
											<EyeOff size={14} />
										</Button>
									</Tooltip>
									<Tooltip content={t('terminal.refresh_list', '刷新列表')}>
										<Button size="1" variant="ghost" color="indigo" onClick={refresh} className="xshell-icon-btn">
											<RefreshCw size={14} />
										</Button>
									</Tooltip>
									<Tooltip content={fullscreen ? t('terminal.exit_fullscreen', '退出全屏') : t('terminal.fullscreen', '全屏')}>
										<Button size="1" variant="ghost" color="indigo" onClick={() => setFullscreen(s => !s)} className="xshell-icon-btn">
											<Maximize2 size={14} />
										</Button>
									</Tooltip>
								</div>
							</div>

							<div className="xshell-search">
								<div className="xshell-search-row">
									<SegmentedControl.Root size="1" value={viewMode} onValueChange={v => setViewMode(v as 'list' | 'group')}>
										<SegmentedControl.Item value="list">
											<ListTree size={14} />
										</SegmentedControl.Item>
										<SegmentedControl.Item value="group">
											<FolderTree size={14} />
										</SegmentedControl.Item>
									</SegmentedControl.Root>
									<TextField.Root
										size="2"
										placeholder={t('admin.nodeTable.searchByName')}
										value={searchTerm}
										onChange={e => setSearchTerm(e.target.value)}>
										<TextField.Slot>
											<Search size={14} />
										</TextField.Slot>
									</TextField.Root>
								</div>
							</div>

							<div className="xshell-list">
								{viewMode === 'list'
									? filteredNodes.map(node => (
											<SessionRowForwarded
												key={node.uuid}
												node={node}
												ref={el => {
													if (el) nodeRefs.current.set(node.uuid, el)
													else nodeRefs.current.delete(node.uuid)
												}}
												online={onlineSet.has(node.uuid)}
												active={focusedNode === node.uuid || activeTab === node.uuid}
												onDoubleClick={() => handleOpenNode(node)}
												onSelect={() => setFocusedNode(node.uuid)}
											/>
									  ))
									: groupedNodes.map(([groupName, nodes]) => (
											<div key={groupName} className="xshell-group">
												<div className="xshell-group-title">
													<span>{groupName}</span>
													<Badge size="1" color="indigo" variant="solid" className="xshell-count-badge">
														{nodes.length}
													</Badge>
												</div>
												<div className="flex flex-col gap-1">
													{nodes.map(node => (
														<SessionRowForwarded
															key={node.uuid}
															node={node}
															ref={el => {
																if (el) nodeRefs.current.set(node.uuid, el)
																else nodeRefs.current.delete(node.uuid)
															}}
															online={onlineSet.has(node.uuid)}
															active={focusedNode === node.uuid || activeTab === node.uuid}
															onDoubleClick={() => handleOpenNode(node)}
															onSelect={() => setFocusedNode(node.uuid)}
														/>
													))}
												</div>
											</div>
									  ))}
							</div>
						</div>

						<div className="xshell-workspace">
							<div className="xshell-tabs" onWheel={handleTabWheel}>
								<div className="xshell-tabs-arrows">
									<button
										className="xshell-tabs-arrow"
										onClick={() => {
											if (tabListRef.current) tabListRef.current.scrollLeft -= 120
										}}
										title={t('common.prev', '向左')}>
										<ChevronLeft size={14} />
									</button>
								</div>
								<div className="xshell-tab-list" ref={tabListRef} onWheel={handleTabWheel}>
									{tabs.length === 0 && (
										<div className="xshell-tab muted">
											<MonitorDot size={14} />
											<span>{t('terminal.no_active_connection')}</span>
										</div>
									)}
									{tabs.map(tab => (
										<button
											key={tab.uuid}
											className={`xshell-tab ${activeTab === tab.uuid ? 'active' : ''}`}
											onClick={() => setActiveTab(tab.uuid)}
											ref={el => {
												if (el) tabRefs.current.set(tab.uuid, el)
												else tabRefs.current.delete(tab.uuid)
											}}
											onMouseDown={e => {
												if (e.button === 1) {
													e.preventDefault()
													e.stopPropagation()
													handleCloseTab(tab.uuid)
												} else if (e.button === 2) {
													e.preventDefault()
													e.stopPropagation()
													setTabMenu({
														open: true,
														x: e.clientX,
														y: e.clientY,
														tabId: tab.uuid
													})
												}
											}}
											onContextMenu={e => {
												e.preventDefault()
												e.stopPropagation()
												setTabMenu({
													open: true,
													x: e.clientX,
													y: e.clientY,
													tabId: tab.uuid
												})
											}}>
											<span className="xshell-status" data-status={tab.status} />
											<span className="truncate">{tab.name}</span>
											<span
												className="xshell-tab-close"
												onClick={e => {
													e.stopPropagation()
													handleCloseTab(tab.uuid)
												}}>
												<X size={12} />
											</span>
										</button>
									))}
								</div>
								<div className="xshell-tabs-arrows">
									<button
										className="xshell-tabs-arrow"
										onClick={() => {
											if (tabListRef.current) tabListRef.current.scrollLeft += 120
										}}
										title={t('common.next', '下一步')}>
										<ChevronRight size={14} />
									</button>
									<button
										className={`xshell-tab-toggle ${showCommands ? 'active' : ''}`}
										onClick={() => setShowCommands(s => !s)}
										title={t('terminal.toggle_commands', '命令面板')}>
										<ChevronDown size={14} />
									</button>
								</div>
							</div>

							<div className="xshell-content" ref={contentRef}>
								{tabs.length === 0 && (
									<div className="xshell-empty">
										<TerminalSquare size={24} />
										<p className="text-sm text-slate-300">{t('terminal.no_active_connection')}</p>
										<p className="text-xs text-slate-500">
											{t('terminal.empty_hint', '在左侧双击服务器以创建会话，已打开的会话会保留在上方标签中。')}
										</p>
									</div>
								)}
								{tabs.map(tab => (
									<TerminalPane key={tab.uuid} session={tab} active={activeTab === tab.uuid} onStatusChange={handleStatusChange} />
								))}
								{showCommands && (
									<>
										<div
											className="xshell-command-resizer"
											onMouseDown={e => {
												e.preventDefault()
												dragStateRef.current = { y: e.clientY, height: commandHeight }
												const handleMove = (ev: MouseEvent) => {
													if (!dragStateRef.current || !contentRef.current) return
													const delta = dragStateRef.current.y - ev.clientY
													const maxH = Math.max(120, contentRef.current.clientHeight * 0.5)
													const next = Math.min(Math.max(120, dragStateRef.current.height + delta), maxH)
													setCommandHeight(next)
												}
												const handleUp = () => {
													dragStateRef.current = null
													document.removeEventListener('mousemove', handleMove)
													document.removeEventListener('mouseup', handleUp)
												}
												document.addEventListener('mousemove', handleMove)
												document.addEventListener('mouseup', handleUp)
											}}
										/>
										<CommandPanel
											activeTab={activeTab}
											onSend={cmd => {
												if (activeTab) senderMapRef.current.get(activeTab)?.(cmd)
											}}
											height={commandHeight}
										/>
									</>
								)}
							</div>
							{tabMenu.open && tabMenu.tabId && (
								<div
									className="xshell-tab-menu"
									style={{ top: tabMenu.y, left: tabMenu.x }}
									onMouseDown={e => e.stopPropagation()}
									onClick={e => e.stopPropagation()}>
									<button
										onClick={() => {
											handleCloseTab(tabMenu.tabId!)
											setTabMenu(m => ({ ...m, open: false }))
										}}>
										{t('close', '关闭')}
									</button>
									<button
										onClick={() => {
											handleCloseLeft(tabMenu.tabId!)
											setTabMenu(m => ({ ...m, open: false }))
										}}>
										{t('close_left', '关闭左侧连接')}
									</button>
									<button
										onClick={() => {
											handleCloseRight(tabMenu.tabId!)
											setTabMenu(m => ({ ...m, open: false }))
										}}>
										{t('close_right', '关闭右侧连接')}
									</button>
									<button
										onClick={() => {
											handleCloseAll()
											setTabMenu(m => ({ ...m, open: false }))
										}}>
										{t('close_all', '全部关闭')}
									</button>
								</div>
							)}
						</div>
					</div>
				</PrivacyContext.Provider>
			</SenderContext.Provider>
		</ConnectionContext.Provider>
	)
}

const SessionRow = ({ node, active, online, onDoubleClick, onSelect }: SessionRowProps, ref: React.ForwardedRef<HTMLDivElement>) => {
	const [t] = useTranslation()
	const [copied, setCopied] = useState(false)
	const isOffline = !online
	const { privacyMode } = useContext(PrivacyContext)

	const formatIp = (ip?: string | null) => {
		if (!ip) return 'N/A'
		if (!privacyMode) return ip
		if (ip.includes(':')) {
			const parts = ip.split(':').filter(p => p !== '')
			const prefix = parts.slice(0, 4).join(':') || parts.slice(0, 2).join(':')
			return prefix ? `${prefix}:*:*:*` : '*:*:*:*'
		}
		const segments = ip.split('.')
		if (segments.length >= 4) {
			return `${segments[0]}.${segments[1]}.*.*`
		}
		return ip
	}
	return (
		<motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.15 }}>
			<div
				className={`xshell-row ${active ? 'active' : ''} ${isOffline ? 'offline' : ''}`}
				onDoubleClick={() => {
					if (isOffline) return
					onDoubleClick()
				}}
				onClick={() => {
					if (isOffline) return
					onSelect()
				}}
				ref={ref}>
				<div className="flex items-center gap-2 justify-between">
					<div className="flex items-center gap-2 overflow-hidden xshell-row-primary">
						<Flag flag={node.region} size="5" />
						<span className="xshell-row-title">{node.name}</span>
					</div>
				</div>
				<div className="xshell-row-meta">
					<div className="xshell-meta-left">
						<button
							className="xshell-ip-button"
							onClick={e => {
								e.stopPropagation()
								const targetIp = node.ipv4 || node.ipv6 || ''
								if (!targetIp) return
								navigator.clipboard.writeText(targetIp).then(() => {
									setCopied(true)
									setTimeout(() => setCopied(false), 1200)
								})
							}}
							title={t('terminal.copy_ip', '点击复制 IP')}>
							{formatIp(node.ipv4 || node.ipv6)}
						</button>
						<span className={`xshell-copy-hint ${copied ? 'show' : ''}`}>{t('terminal.copy_ip', '已复制')}</span>
					</div>
					<span className={`xshell-status-chip ${online ? 'online' : 'offline'}`}>
						{online ? t('terminal.online', '在线') : t('terminal.offline', '已离线')}
					</span>
				</div>
				{isOffline && (
					<div className="xshell-offline-overlay">
						<span>{t('terminal.offline', '已离线')}</span>
					</div>
				)}
			</div>
		</motion.div>
	)
}
const SessionRowForwarded = forwardRef<HTMLDivElement, SessionRowProps>(SessionRow)

const TerminalPane = ({
	session,
	active,
	onStatusChange
}: {
	session: SessionTab
	active: boolean
	onStatusChange: (uuid: string, status: SessionStatus) => void
}) => {
	const [t] = useTranslation()
	const ref = useRef<HTMLDivElement | null>(null)
	const termRef = useRef<XTerm | null>(null)
	const fitRef = useRef<FitAddon | null>(null)
	const wsRef = useRef<WebSocket | null>(null)
	const heartbeatRef = useRef<NodeJS.Timeout | null>(null)
	const firstBinary = useRef(false)
	const resizeObserverRef = useRef<ResizeObserver | null>(null)
	const disposedRef = useRef(false)
	const timersRef = useRef<number[]>([])
	const closingRef = useRef(false)
	const { registerSocket, unregisterSocket } = useContext(ConnectionContext)
	const { registerSender, unregisterSender } = useContext(SenderContext)

	const sendResize = useCallback(() => {
		if (disposedRef.current) return
		const term = termRef.current
		const ws = wsRef.current
		if (!term || !fitRef.current) return
		try {
			fitRef.current.fit()
		} catch {
			return
		}
		if (term && ws && ws.readyState === WebSocket.OPEN) {
			ws.send(
				JSON.stringify({
					type: 'resize',
					cols: term.cols,
					rows: term.rows
				})
			)
		}
	}, [])

	const stopHeartbeat = () => {
		if (heartbeatRef.current) {
			clearInterval(heartbeatRef.current)
			heartbeatRef.current = null
		}
	}

	useEffect(() => {
		disposedRef.current = false
		closingRef.current = false
		const addTimer = (fn: () => void, delay: number) => {
			const id = window.setTimeout(fn, delay)
			timersRef.current.push(id)
		}
		let cleanupResizeObs: (() => void) | undefined
		const initTerminal = () => {
			const container = ref.current
			if (!container) return
			if (container.clientWidth === 0 || container.clientHeight === 0) {
				// 如果容器尚未可见，稍后再尝试
				addTimer(initTerminal, 80)
				return
			}

			// 检测当前主题模式
			const isDark = document.documentElement.classList.contains('dark')

			const term = new XTerm({
				cursorBlink: true,
				macOptionIsMeta: true,
				scrollback: 5000,
				convertEol: true,
				fontFamily: "'Cascadia Mono', 'Fira Code', 'Noto Sans SC', 'Consolas', 'Menlo', monospace",
				fontSize: 14,
				letterSpacing: 0,
				lineHeight: 1.1,
				theme: isDark ? {
					background: '#05080f',
					foreground: '#e7ecf5',
					cursor: '#7cb7ff',
					cursorAccent: '#05080f',
					selectionBackground: 'rgba(124, 183, 255, 0.3)',
					black: '#1e1e1e',
					red: '#f87171',
					green: '#4ade80',
					yellow: '#fbbf24',
					blue: '#60a5fa',
					magenta: '#c084fc',
					cyan: '#22d3ee',
					white: '#e5e7eb',
					brightBlack: '#6b7280',
					brightRed: '#fca5a5',
					brightGreen: '#86efac',
					brightYellow: '#fcd34d',
					brightBlue: '#93c5fd',
					brightMagenta: '#d8b4fe',
					brightCyan: '#67e8f9',
					brightWhite: '#f3f4f6'
				} : {
					background: '#f8f9fa',
					foreground: '#212529',
					cursor: '#2f5bea',
					cursorAccent: '#f8f9fa',
					selectionBackground: 'rgba(47, 91, 234, 0.2)',
					black: '#212529',
					red: '#dc2626',
					green: '#16a34a',
					yellow: '#ca8a04',
					blue: '#2563eb',
					magenta: '#9333ea',
					cyan: '#0891b2',
					white: '#f3f4f6',
					brightBlack: '#6b7280',
					brightRed: '#ef4444',
					brightGreen: '#22c55e',
					brightYellow: '#eab308',
					brightBlue: '#3b82f6',
					brightMagenta: '#a855f7',
					brightCyan: '#06b6d4',
					brightWhite: '#ffffff'
				}
			})
			// 强制使用 canvas 渲染（部分版本 typings 无该字段）
			try {
				;(term as any).setOption?.('rendererType', 'canvas')
			} catch {
				/* ignore */
			}

			const fitAddon = new FitAddon()
			const webLinksAddon = new WebLinksAddon()
			const searchAddon = new SearchAddon()
			term.loadAddon(fitAddon)
			term.loadAddon(webLinksAddon)
			term.loadAddon(searchAddon)

			term.open(container)
			const handleMouseUp = () => {
				const termSelection = term.getSelection()
				const domSelection = window.getSelection()?.toString()
				const raw = (termSelection && termSelection.length > 0 ? termSelection : domSelection) || ''
				const normalized = raw.replace(/\u00a0/g, ' ').replace(/\r?\n\s+$/g, '\n')
				if (!normalized.trim()) return
				navigator.clipboard
					.writeText(normalized)
					.then(() => {
						window.getSelection()?.removeAllRanges()
						term.clearSelection()
						toast.success(t('terminal.copy_selection', '已复制'))
					})
					.catch(() => undefined)
			}
			const handleContextMenu = (e: MouseEvent) => {
				e.preventDefault()
				const target = wsRef.current
				if (!target || target.readyState !== WebSocket.OPEN) return
				navigator.clipboard
					.readText()
					.then(text => {
						if (!text) return
						const encoder = new TextEncoder()
						target.send(encoder.encode(text.replace(/\r?\n/g, '\r')))
					})
					.catch(() => undefined)
			}
			container.addEventListener('mouseup', handleMouseUp)
			container.addEventListener('contextmenu', handleContextMenu)

			const scheduleFit = () => {
				if (disposedRef.current) return
				sendResize()
				requestAnimationFrame(() => sendResize())
				addTimer(() => sendResize(), 120)
				addTimer(() => sendResize(), 260)
			}
			try {
				fitAddon.fit()
				scheduleFit()
			} catch {
				// ignore fit errors
			}
			if (document.fonts && document.fonts.ready) {
				document.fonts.ready.then(() => addTimer(scheduleFit, 30))
			}

			// 监听容器尺寸变化，保持排版
			const ro = new ResizeObserver(() => scheduleFit())
			ro.observe(container)
			resizeObserverRef.current = ro
			cleanupResizeObs = () => ro.disconnect()

			termRef.current = term
			fitRef.current = fitAddon
			registerSender(session.uuid, (cmd: string) => {
				const target = wsRef.current
				if (target && target.readyState === WebSocket.OPEN) {
					const encoder = new TextEncoder()
					target.send(encoder.encode(cmd.endsWith('\n') ? cmd : `${cmd}\n`))
				}
			})

			const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
			const host = window.location.host
			const baseUrl = `${protocol}//${host}`

			const connectWS = () => {
				if (disposedRef.current || closingRef.current) return
				const ws = new WebSocket(`${baseUrl}/api/admin/client/${session.uuid}/terminal`)
				ws.binaryType = 'arraybuffer'
				wsRef.current = ws
				registerSocket(ws)

				ws.onopen = () => {
					onStatusChange(session.uuid, 'open')
					scheduleFit()
					heartbeatRef.current = setInterval(() => {
						if (ws.readyState === WebSocket.OPEN) {
							ws.send(
								JSON.stringify({
									type: 'heartbeat',
									timestamp: new Date().toISOString()
								})
							)
						}
					}, 10000)
				}

				ws.onmessage = event => {
					const termInstance = termRef.current
					if (!termInstance) return

					if (event.data instanceof ArrayBuffer) {
						const uint8Array = new Uint8Array(event.data)
						termInstance.write(uint8Array)
					} else {
						termInstance.write(event.data)
					}
					if (!firstBinary.current && event.data instanceof ArrayBuffer) {
						firstBinary.current = true
						addTimer(scheduleFit, 200)
					}
				}

				ws.onerror = () => {
					onStatusChange(session.uuid, 'closed')
					term.write('\r\n[terminal connection error]')
				}

				ws.onclose = () => {
					if (ws !== wsRef.current) return
					stopHeartbeat()
					unregisterSocket(ws)
					onStatusChange(session.uuid, 'closed')
					term.write('\r\n[terminal disconnected]')
					if (!disposedRef.current && !closingRef.current) {
						onStatusChange(session.uuid, 'connecting')
						addTimer(connectWS, 1500)
					}
				}

				term.onData(data => {
					const target = wsRef.current
					if (target && target.readyState === WebSocket.OPEN) {
						const encoder = new TextEncoder()
						const uint8Array = encoder.encode(data)
						target.send(uint8Array)
					}
				})
			}

			connectWS()

			const onWindowResize = () => scheduleFit()
			window.addEventListener('resize', onWindowResize)

			return () => {
				closingRef.current = true
				stopHeartbeat()
				cleanupResizeObs?.()
				container.removeEventListener('mouseup', handleMouseUp)
				container.removeEventListener('contextmenu', handleContextMenu)
				window.removeEventListener('resize', onWindowResize)
				if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
					wsRef.current.close()
				}
				if (wsRef.current) unregisterSocket(wsRef.current)
				unregisterSender(session.uuid)
				term.dispose()
				termRef.current = null
				wsRef.current = null
			}
		}

		const cleanup = initTerminal()
		return () => {
			disposedRef.current = true
			timersRef.current.forEach(id => clearTimeout(id))
			timersRef.current = []
			cleanup?.()
		}
	}, [session.uuid, onStatusChange, sendResize])

	useEffect(() => {
		if (active) {
			setTimeout(() => {
				sendResize()
				termRef.current?.focus()
			}, 80)
		}
	}, [active, sendResize])

	return (
		<div className="xshell-pane" style={{ display: active ? 'flex' : 'none' }}>
			<div className="xshell-terminal" ref={ref} />
		</div>
	)
}

export default TerminalWorkbenchPage
