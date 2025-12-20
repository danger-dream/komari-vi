import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Checkbox, Dialog } from '@radix-ui/themes'
import { FilePlus, FolderPlus, Play, RefreshCw, Save, StopCircle, Trash2, X, Plus, Edit3, Settings } from 'lucide-react'
import Editor from '@monaco-editor/react'
import { RPC2Client } from '@/lib/rpc2'
import { toast } from 'sonner'
import { NodeDetailsProvider } from '@/contexts/NodeDetailsContext'
import NodeSelectorDialog from '@/components/NodeSelectorDialog'
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels'

import { TreeNode } from '@/components/workbench/TreeNode'
import { ConfigPanel } from '@/components/workbench/ConfigPanel'
import { LogPanel } from '@/components/workbench/LogPanel'
import { HistoryPanel } from '@/components/workbench/HistoryPanel'
import { VariablePanel } from '@/components/workbench/VariablePanel'
import type {
	ScriptFolder,
	ScriptItem,
	HistoryItem,
	VariableItem,
	LogLine,
	TreeFolder,
	HistoryLogEntry,
} from '@/components/workbench/types'
import { buildTree, guessValueType, nilToNull } from '@/components/workbench/utils'
import {
	VscodePanel,
	VscodePanelHeader,
	VscodeTabsContainer,
	VscodeTab,
	VscodeButton,
	VscodeDivider,
	VscodeInput,
	VscodeTextArea,
	VscodeSelect,
} from '@/components/workbench/VscodePanel'

const ScriptWorkbench = () => {
	const [folders, setFolders] = useState<ScriptFolder[]>([])
	const [scripts, setScripts] = useState<ScriptItem[]>([])
	const [openTabs, setOpenTabs] = useState<number[]>([])
	const [expandedFolders, setExpandedFolders] = useState<Set<number>>(new Set())
	const [activeId, setActiveId] = useState<number | null>(null)
	const [editorValue, setEditorValue] = useState<Record<number, string>>({})
	const [panelTab, setPanelTab] = useState<'config' | 'logs' | 'history' | 'vars'>('logs')
	const [currentExecId, setCurrentExecId] = useState<string>('')
	const [history, setHistory] = useState<HistoryItem[]>([])
	const [selectedHistory, setSelectedHistory] = useState<HistoryItem | null>(null)
	const [variables, setVariables] = useState<VariableItem[]>([])
	const [varScope, setVarScope] = useState<'script' | 'node' | 'global'>('script')
	const [nodeFilter, setNodeFilter] = useState<string>('')
	const [logs, setLogs] = useState<LogLine[]>([])
	const [autoScrollLogs, setAutoScrollLogs] = useState(true)
	const [saving, setSaving] = useState(false)
	const [running, setRunning] = useState(false)
	const rpcClientRef = useRef<RPC2Client | null>(null)
	const [dirty, setDirty] = useState<Record<number, boolean>>({})
	const activeRef = useRef<number | null>(null)
	const execRef = useRef<string>('')
	const [subscribed, setSubscribed] = useState<{ scriptId: number; execId: string } | null>(null)
	const [selectedFolder, setSelectedFolder] = useState<number | null>(null)
	const stopNoticeShown = useRef(false)
	const subscribedRef = useRef<{ scriptId: number; execId: string } | null>(null)
	const [runDialogOpen, setRunDialogOpen] = useState(false)
	const [runClients, setRunClients] = useState<string[]>([])
	const [paramText, setParamText] = useState('{}')
	const logsEndRef = useRef<HTMLDivElement | null>(null)
	const [configClientDialogOpen, setConfigClientDialogOpen] = useState(false)
	const [configClientTarget, setConfigClientTarget] = useState<ScriptItem | null>(null)
	const [configClientsSelection, setConfigClientsSelection] = useState<string[]>([])
	const [nodePickerOpen, setNodePickerOpen] = useState(false)
	const [inputDialog, setInputDialog] = useState<{ open: boolean; title: string; defaultValue?: string; onConfirm: (value: string) => void } | null>(null)
	const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; message: string; onConfirm: () => void } | null>(null)

	useEffect(() => {
		activeRef.current = activeId
		execRef.current = currentExecId
	}, [activeId, currentExecId])

	useEffect(() => {
		subscribedRef.current = subscribed
	}, [subscribed])

	useEffect(() => {
		loadStructure()
		loadScripts()
		const client = new RPC2Client('/api/rpc2', { autoConnect: true })
		client.setEventListeners({
			onMessage: data => {
				const method = (data as any)?.method
				if (method === 'admin:script_logs.event') {
					const evt = (data as any).params as LogLine
					if (evt && activeRef.current === (evt as any).script_id && (!execRef.current || (evt as any).exec_id === execRef.current)) {
						setLogs(prev => [
							...prev,
							{
								script_id: (evt as any).script_id,
								exec_id: (evt as any).exec_id,
								time: evt.time,
								level: evt.level,
								message: evt.message,
								client_uuid: (evt as any).client_uuid
							}
						])
					}
				}
			}
		})
		rpcClientRef.current = client
		return () => {
			const latest = subscribedRef.current
			if (latest) {
				unsubscribeLogs(latest.scriptId, latest.execId).catch(() => {})
			}
			client.disconnect()
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [])

	useEffect(() => {
		const next = new Set<number>([0])
		folders.forEach(f => next.add(f.id))
		setExpandedFolders(next)
	}, [folders])

	useEffect(() => {
		setOpenTabs(prev => prev.filter(id => scripts.some(s => s.id === id)))
		if (activeId && !scripts.some(s => s.id === activeId)) {
			setActiveId(null)
			setCurrentExecId('')
			setLogs([])
		}
	}, [scripts])

	useEffect(() => {
		if (autoScrollLogs && logsEndRef.current) {
			logsEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' })
		}
	}, [logs, autoScrollLogs])

	const activeScript = useMemo(() => scripts.find(s => s.id === activeId) || null, [scripts, activeId])
	const execOptions = useMemo(() => {
		const ids = history.map(h => h.exec_id).filter((id): id is string => Boolean(id))
		if (currentExecId && !ids.includes(currentExecId)) {
			ids.unshift(currentExecId)
		}
		return Array.from(new Set(ids))
	}, [history, currentExecId])

	useEffect(() => {
		if (activeScript) {
			fetchHistory(activeScript.id)
			fetchVariables(activeScript.id)
			setRunClients(activeScript.clients || [])
			setSelectedHistory(null)
		} else {
			setHistory([])
			if (varScope === 'global') {
				fetchVariables(0)
			} else {
				setVariables([])
			}
			setRunClients([])
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [activeScript?.id, varScope, nodeFilter])

	const loadStructure = async () => {
		try {
			const res = await fetch('/api/admin/script/structure')
			const data = await res.json()
			if (data.status === 'success') {
				setFolders(data.data.folders || [])
				if (Array.isArray(data.data.scripts)) {
					setScripts(data.data.scripts)
				}
			}
		} catch (e) {
			console.error(e)
		}
	}

	const loadScripts = async () => {
		try {
			const res = await fetch('/api/admin/script')
			const data = await res.json()
			if (data.status === 'success') {
				setScripts(data.data || [])
			}
		} catch (e) {
			console.error(e)
		}
	}

	const selectScript = (id: number) => {
		// 切换脚本时取消旧订阅
		if (subscribed) {
			unsubscribeLogs(subscribed.scriptId, subscribed.execId).catch(() => {})
			setSubscribed(null)
		}
		setOpenTabs(prev => (prev.includes(id) ? prev : [...prev, id]))
		setActiveId(id)
		const found = scripts.find(s => s.id === id)
		if (found && editorValue[id] === undefined) {
			setEditorValue(prev => ({ ...prev, [id]: found.script_body }))
		}
		if (found?.folder_id) {
			setSelectedFolder(found.folder_id)
		}
		setLogs([])
		setCurrentExecId('')
	}

	const closeTab = (id: number) => {
		setOpenTabs(prev => {
			const next = prev.filter(t => t !== id)
			if (id === activeId) {
				const newActive = next[next.length - 1] ?? null
				setActiveId(newActive)
				setCurrentExecId('')
				setLogs([])
			}
			return next
		})
	}

	const handleSavePartial = async (scriptToSave: ScriptItem) => {
		const payload = {
			scripts: [
				{
					...scriptToSave,
					script_body: editorValue[scriptToSave.id] ?? scriptToSave.script_body
				}
			]
		}
		const res = await fetch('/api/admin/script/edit', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload)
		})
		return res.json()
	}

	const handleSave = async () => {
		if (!activeScript) return
		setSaving(true)
		try {
			const data = await handleSavePartial(activeScript)
			if (data.status === 'success') {
				toast.success('保存成功')
				setDirty(prev => ({ ...prev, [activeScript.id]: false }))
				loadScripts()
			} else {
				toast.error(data.message || '保存失败')
			}
		} catch (e) {
			console.error(e)
			toast.error('保存失败')
		} finally {
			setSaving(false)
		}
	}

	const subscribeLogs = async (scriptId: number, execId: string) => {
		try {
			await rpcClientRef.current?.callViaWebSocket('admin:script_logs.subscribe', { script_id: scriptId, exec_id: execId })
			setSubscribed({ scriptId, execId })
		} catch (e) {
			console.error(e)
		}
	}

	const unsubscribeLogs = async (scriptId: number, execId: string) => {
		try {
			await rpcClientRef.current?.callViaWebSocket('admin:script_logs.unsubscribe', { script_id: scriptId, exec_id: execId })
			setSubscribed(null)
		} catch (e) {
			console.error(e)
		}
	}

	const handleRun = async () => {
		if (!activeScript) return
		setRunDialogOpen(true)
	}

	const executeScript = async () => {
		if (!activeScript) return
		let params: Record<string, any> | undefined
		if (paramText.trim()) {
			try {
				params = JSON.parse(paramText)
			} catch (e) {
				toast.error('参数 JSON 解析失败')
				return
			}
		}
		const selectedClients = runClients.length > 0 ? runClients : undefined
		setRunning(true)
		setRunDialogOpen(false)
		try {
			const res = await fetch('/api/admin/script/execute', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id: activeScript.id, clients: selectedClients, params })
			})
			const data = await res.json()
			if (data.status === 'success') {
				const execId = data.data.exec_id
				setCurrentExecId(execId)
				setLogs([])
				if (subscribed) {
					await unsubscribeLogs(subscribed.scriptId, subscribed.execId)
				}
				await subscribeLogs(activeScript.id, execId)
				setPanelTab('logs')
				fetchHistory(activeScript.id)
			} else {
				toast.error(data.message || '执行失败')
			}
		} catch (e) {
			console.error(e)
			toast.error('执行失败')
		} finally {
			setRunning(false)
		}
	}

	const fetchHistory = async (scriptId: number) => {
		try {
			const res = await fetch(`/api/admin/script/history?script_id=${scriptId}&limit=50`)
			const data = await res.json()
			if (data.status === 'success') {
				setHistory(data.data || [])
				setSelectedHistory((data.data || [])[0] || null)
			}
		} catch (e) {
			console.error(e)
		}
	}

	const fetchVariables = async (scriptId: number) => {
		try {
			const params = new URLSearchParams({ scope: varScope })
			if (varScope !== 'global') {
				params.set('script_id', String(scriptId))
			}
			if (varScope === 'node') {
				if (nodeFilter) {
					params.set('client_uuid', nodeFilter)
				}
			}
			const res = await fetch(`/api/admin/script/variables?${params.toString()}`)
			const data = await res.json()
			if (data.status === 'success') {
				setVariables(data.data || [])
			}
		} catch (e) {
			console.error(e)
		}
	}

	const handleSelectHistoryExec = async (execId: string) => {
		if (!activeScript) return
		if (!execId) {
			setCurrentExecId('')
			setLogs([])
			if (subscribed) {
				await unsubscribeLogs(subscribed.scriptId, subscribed.execId)
			}
			return
		}
		setCurrentExecId(execId)
		setLogs([])
		setSelectedHistory(history.find(h => h.exec_id === execId) || null)
		if (subscribed) {
			await unsubscribeLogs(subscribed.scriptId, subscribed.execId)
		}
		await subscribeLogs(activeScript.id, execId)
		setPanelTab('logs')
	}

	const createVariable = async () => {
		if (!activeScript && varScope !== 'global') return
		setInputDialog({
			open: true,
			title: '新建变量 - 变量名',
			defaultValue: '',
			onConfirm: async key => {
				if (!key) return
				setInputDialog({
					open: true,
					title: '新建变量 - 变量值 (JSON)',
					defaultValue: '',
					onConfirm: async val => {
						if (val === null) return
						const payload = {
							scope: varScope,
							script_id: varScope === 'global' ? undefined : activeScript?.id,
							client_uuid: varScope === 'node' ? nodeFilter : undefined,
							key,
							value: val,
							value_type: guessValueType(val)
						}
						const res = await fetch('/api/admin/script/variable/set', {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify(payload)
						})
						const data = await res.json()
						if (data.status === 'success') {
							toast.success('变量已保存')
							fetchVariables(activeScript?.id || 0)
						} else {
							toast.error(data.message || '保存失败')
						}
						setInputDialog(null)
					}
				})
			}
		})
	}

	const removeVariable = async (id: number) => {
		const res = await fetch('/api/admin/script/variable/delete', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id })
		})
		const data = await res.json()
		if (data.status === 'success') {
			toast.success('已删除变量')
			fetchVariables(activeScript?.id || 0)
		} else {
			toast.error(data.message || '删除失败')
		}
	}

	const editVariable = async (item: VariableItem) => {
		setInputDialog({
			open: true,
			title: `编辑变量 "${item.key}" 的值 (JSON)`,
			defaultValue: item.value,
			onConfirm: async val => {
				if (val === null) return
				const payload = {
					scope: item.scope,
					script_id: item.scope === 'global' ? undefined : item.script_id,
					client_uuid: item.scope === 'node' ? item.client_uuid : undefined,
					key: item.key,
					value: val,
					value_type: guessValueType(val)
				}
				const res = await fetch('/api/admin/script/variable/set', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(payload)
				})
				const data = await res.json()
				if (data.status === 'success') {
					toast.success('已更新变量')
					fetchVariables(activeScript?.id || 0)
				} else {
					toast.error(data.message || '更新失败')
				}
				setInputDialog(null)
			}
		})
	}

	const tree = useMemo(() => buildTree(folders, scripts), [folders, scripts])
	const toggleFolder = (id: number) => {
		setExpandedFolders(prev => {
			const next = new Set(prev)
			if (next.has(id)) {
				next.delete(id)
			} else {
				next.add(id)
			}
			return next
		})
	}

	const addFolder = async (parentId?: number | null) => {
		setInputDialog({
			open: true,
			title: '新建目录',
			defaultValue: '',
			onConfirm: async name => {
				if (!name) return
				const parent = parentId && parentId > 0 ? parentId : null
				const res = await fetch('/api/admin/script/folder/add', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ name, parent_id: nilToNull(parent), order: 0 })
				})
				const data = await res.json()
				if (data.status === 'success') {
					toast.success('已创建目录')
					loadStructure()
				} else {
					toast.error(data.message || '创建失败')
				}
				setInputDialog(null)
			}
		})
	}

	const renameFolder = async (folder: ScriptFolder) => {
		setInputDialog({
			open: true,
			title: '重命名目录',
			defaultValue: folder.name,
			onConfirm: async name => {
				if (!name) return
				const res = await fetch('/api/admin/script/folder/edit', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ ...folder, name })
				})
				const data = await res.json()
				if (data.status === 'success') {
					toast.success('已重命名')
					loadStructure()
				} else {
					toast.error(data.message || '重命名失败')
				}
				setInputDialog(null)
			}
		})
	}

	const deleteFolder = async (folder: ScriptFolder) => {
		setConfirmDialog({
			open: true,
			message: `确定要删除目录 "${folder.name}" 吗？`,
			onConfirm: async () => {
				const res = await fetch('/api/admin/script/folder/delete', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ id: folder.id })
				})
				const data = await res.json()
				if (data.status === 'success') {
					toast.success('已删除目录')
					loadStructure()
				} else {
					toast.error(data.message || '删除失败')
				}
				setConfirmDialog(null)
			}
		})
	}

	const addScript = async (folderId?: number | null) => {
		setInputDialog({
			open: true,
			title: '新建脚本',
			defaultValue: '',
			onConfirm: async name => {
				if (!name) return
				const targetFolder = folderId && folderId > 0 ? folderId : null
				const res = await fetch('/api/admin/script/add', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						name,
						folder_id: nilToNull(targetFolder),
						enabled: true,
						trigger_kind: 'manual',
						timeout_sec: 0,
						script_body: "async function run(ctx) {\n  console.log('hello');\n}\n",
						clients: [],
						depends_on_scripts: [],
						depends_on_folders: []
					})
				})
				const data = await res.json()
				if (data.status === 'success') {
					toast.success('已创建脚本')
					loadStructure()
					loadScripts()
				} else {
					toast.error(data.message || '创建失败')
				}
				setInputDialog(null)
			}
		})
	}

	const renameScript = async (script: ScriptItem) => {
		setInputDialog({
			open: true,
			title: '重命名脚本',
			defaultValue: script.name,
			onConfirm: async name => {
				if (!name) return
				const data = await handleSavePartial({ ...script, name })
				if (data.status === 'success') {
					toast.success('已重命名脚本')
					loadScripts()
				} else {
					toast.error(data.message || '重命名失败')
				}
				setInputDialog(null)
			}
		})
	}

	const deleteScript = async (script: ScriptItem) => {
		setConfirmDialog({
			open: true,
			message: `确定要删除脚本 "${script.name}" 吗？`,
			onConfirm: async () => {
				const res = await fetch('/api/admin/script/delete', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ id: script.id })
				})
				const data = await res.json()
				if (data.status === 'success') {
					toast.success('已删除')
					loadScripts()
					loadStructure()
					if (activeId === script.id) {
						setActiveId(null)
						setLogs([])
					}
					setOpenTabs(prev => prev.filter(id => id !== script.id))
				} else {
					toast.error(data.message || '删除失败')
				}
				setConfirmDialog(null)
			}
		})
	}

	const openClientPicker = (script: ScriptItem) => {
		setConfigClientTarget(script)
		setConfigClientsSelection(script.clients || [])
		setConfigClientDialogOpen(true)
	}

	return (
		<NodeDetailsProvider>
			<div className="h-[calc(100vh-80px)] w-full overflow-hidden flex flex-col bg-white dark:bg-vscode-bg text-gray-800 dark:text-vscode-foreground">
				<PanelGroup direction="horizontal">
					<Panel defaultSize={20} minSize={15} maxSize={30}>
						<VscodePanel isFlex className="h-full">
							<VscodePanelHeader
								actions={
									<>
										<VscodeButton small icon={<FolderPlus size={12} />} onClick={() => addFolder(selectedFolder)} title="新建目录" />
										<VscodeButton small icon={<FilePlus size={12} />} onClick={() => addScript(selectedFolder)} title="新建脚本" />
										<VscodeButton small icon={<RefreshCw size={12} />} onClick={() => loadStructure()} title="刷新" />
									</>
								}>
								脚本资源管理器
							</VscodePanelHeader>
							<div className="flex-1 overflow-y-auto pt-2">
								{tree.map(item => (
									<TreeNode
										key={`folder-${item.folder.id}`}
										node={item}
										activeId={activeId}
										onSelect={selectScript}
										onAddFolder={addFolder}
										onAddScript={addScript}
										onRenameFolder={renameFolder}
										onDeleteFolder={deleteFolder}
										onRenameScript={renameScript}
										onDeleteScript={deleteScript}
										setSelectedFolder={setSelectedFolder}
										expanded={expandedFolders.has(item.folder.id)}
										onToggle={toggleFolder}
										expandedSet={expandedFolders}
										isRoot={item.folder.id === 0}
									/>
								))}
							</div>
						</VscodePanel>
					</Panel>
					<PanelResizeHandle className="w-1 bg-gray-200 dark:bg-vscode-border transition-colors hover:bg-blue-500 dark:hover:bg-vscode-focus-border" />
					<Panel>
						<PanelGroup direction="vertical">
							<Panel defaultSize={60} minSize={30}>
								<VscodePanel isFlex className="h-full">
									<VscodeTabsContainer
										actions={
											<>
												<VscodeButton small icon={<Play size={12} />} onClick={handleRun} disabled={!activeScript || running}>
													运行
												</VscodeButton>
												<VscodeButton small icon={<Save size={12} />} onClick={handleSave} disabled={!activeScript || saving}>
													保存
												</VscodeButton>
												{currentExecId && (
													<>
														<VscodeButton
															small
															icon={<StopCircle size={12} />}
															onClick={async () => {
																if (!activeScript || !currentExecId) {
																	toast.info('暂无正在运行的执行可停止')
																	return
																}
																try {
																	const res = await fetch('/api/admin/script/stop', {
																		method: 'POST',
																		headers: { 'Content-Type': 'application/json' },
																		body: JSON.stringify({
																			script_id: activeScript.id,
																			exec_id: currentExecId,
																			clients: runClients.length > 0 ? runClients : activeScript.clients || []
																		})
																	})
																	const data = await res.json()
																	if (data.status === 'success') {
																		toast.success('已发送停止指令')
																	} else {
																		toast.error(data.message || '停止失败')
																	}
																} catch (e) {
																	toast.error('停止失败')
																}
																if (subscribed) {
																	await unsubscribeLogs(subscribed.scriptId, subscribed.execId)
																	setCurrentExecId('')
																	setLogs([])
																}
																if (!stopNoticeShown.current) {
																	toast.info('停止指令已发送，终止依赖 Agent 支持')
																	stopNoticeShown.current = true
																}
															}}>
															停止
														</VscodeButton>
														<VscodeButton
															small
															icon={<StopCircle size={12} />}
															onClick={async () => {
																if (!activeScript || !currentExecId) {
																	toast.info('暂无执行可强制结束')
																	return
																}
																try {
																	const res = await fetch('/api/admin/script/force_stop', {
																		method: 'POST',
																		headers: { 'Content-Type': 'application/json' },
																		body: JSON.stringify({ script_id: activeScript.id, exec_id: currentExecId, clients: runClients })
																	})
																	const data = await res.json()
																	if (data.status === 'success') {
																		toast.success('已强制结束（等待离线节点上线时补发停止指令）')
																	} else {
																		toast.error(data.message || '强制结束失败')
																	}
																} catch (e) {
																	toast.error('强制结束失败')
																}
															}}>
															强制结束
														</VscodeButton>
													</>
												)}
												<VscodeDivider className="h-4" />
												<VscodeButton small icon={<Settings size={12} />} onClick={() => setPanelTab('config')} title="设置" />
											</>
										}>
										{openTabs.length === 0 && (
											<div className="text-gray-500 dark:text-vscode-description-foreground text-sm px-3 py-1">选择左侧脚本以开始</div>
										)}
										{openTabs.map(id => {
											const tabScript = scripts.find(s => s.id === id)
											if (!tabScript) return null
											const isActive = id === activeId
											return (
												<VscodeTab
													key={id}
													active={isActive}
													dirty={dirty[id]}
													onClick={() => selectScript(id)}
													onClose={() => closeTab(id)}>
													{tabScript.name}
												</VscodeTab>
											)
										})}
									</VscodeTabsContainer>
									<div className="flex-1 min-h-0">
										{activeScript ? (
											<Editor
												height="100%"
												language="javascript"
												theme={document.documentElement.classList.contains('dark') ? 'vs-dark' : 'light'}
												options={{ minimap: { enabled: false }, fontSize: 14, fontFamily: 'JetBrains Mono, monospace' }}
												value={editorValue[activeScript.id] ?? activeScript.script_body}
												onChange={value => {
													const next = value ?? ''
													setEditorValue(prev => ({ ...prev, [activeScript.id]: next }))
													setDirty(prev => ({ ...prev, [activeScript.id]: next !== activeScript.script_body }))
												}}
											/>
										) : (
											<div className="h-full flex items-center justify-center text-gray-400 dark:text-vscode-description-foreground text-sm">
												请选择脚本进行编辑
											</div>
										)}
									</div>
								</VscodePanel>
							</Panel>
							<PanelResizeHandle className="h-px bg-gray-200 dark:bg-vscode-border transition-colors hover:bg-blue-500 dark:hover:bg-vscode-focus-border" />
							<Panel defaultSize={40} minSize={20}>
								<VscodePanel isFlex className="h-full">
									<VscodeTabsContainer>
										<VscodeTab type="panel" active={panelTab === 'config'} onClick={() => setPanelTab('config')}>
											配置
										</VscodeTab>
										<VscodeTab type="panel" active={panelTab === 'logs'} onClick={() => setPanelTab('logs')}>
											日志
										</VscodeTab>
										<VscodeTab type="panel" active={panelTab === 'vars'} onClick={() => setPanelTab('vars')}>
											变量
										</VscodeTab>
										<VscodeTab type="panel" active={panelTab === 'history'} onClick={() => setPanelTab('history')}>
											历史
										</VscodeTab>
									</VscodeTabsContainer>
									<div className="flex-1 min-h-0 bg-white dark:bg-vscode-panel-background">
										{panelTab === 'config' && (
											<ConfigPanel
												script={activeScript}
												onChange={s => {
													setScripts(prev => prev.map(it => (it.id === s.id ? s : it)))
													setDirty(prev => ({ ...prev, [s.id]: true }))
												}}
												allScripts={scripts}
												allFolders={folders}
												onPickClients={openClientPicker}
											/>
										)}
										{panelTab === 'logs' && (
											<LogPanel
												logs={logs}
												currentExecId={currentExecId}
												autoScroll={autoScrollLogs}
												onToggleAutoScroll={setAutoScrollLogs}
												onClear={() => setLogs([])}
												execOptions={execOptions}
												onSelectExec={handleSelectHistoryExec}
												endRef={logsEndRef}
											/>
										)}
										{panelTab === 'vars' && (
											<VariablePanel
												scope={varScope}
												onScopeChange={v => setVarScope(v)}
												nodeFilter={nodeFilter}
												onNodeChange={setNodeFilter}
												variables={variables}
												onAdd={createVariable}
												onDelete={removeVariable}
												onEdit={editVariable}
											/>
										)}
										{panelTab === 'history' && (
											<HistoryPanel
												history={history}
												onRefresh={() => activeScript && fetchHistory(activeScript.id)}
												onSelectExec={handleSelectHistoryExec}
												onSelectItem={setSelectedHistory}
												selected={selectedHistory}
											/>
										)}
									</div>
								</VscodePanel>
							</Panel>
						</PanelGroup>
					</Panel>
				</PanelGroup>

				{/* Run Dialog */}
				<Dialog.Root open={runDialogOpen} onOpenChange={setRunDialogOpen}>
					<Dialog.Content style={{ maxWidth: 500 }} className="bg-white dark:bg-vscode-bg border border-gray-300 dark:border-vscode-border">
						<Dialog.Title className="text-gray-800 dark:text-vscode-foreground">运行脚本</Dialog.Title>
						<div className="py-3 flex flex-col gap-4">
							<div>
								<div className="mb-2 flex justify-between items-center">
									<span className="text-sm font-medium text-gray-800 dark:text-vscode-foreground">目标节点</span>
									<VscodeButton small onClick={() => setNodePickerOpen(true)}>
										选择节点
									</VscodeButton>
								</div>
								<span className="text-xs text-gray-500 dark:text-vscode-description-foreground">
									{runClients.length > 0 ? `已选择 ${runClients.length} 个节点` : '未选择（将使用脚本默认配置）'}
								</span>
							</div>
							<div>
								<span className="text-sm font-medium text-gray-800 dark:text-vscode-foreground mb-2">执行参数 (JSON)</span>
								<VscodeTextArea
									value={paramText}
									onChange={e => setParamText(e.target.value)}
									placeholder='{"key": "value"}'
									rows={5}
									className="font-mono text-xs"
								/>
							</div>
						</div>
						<div className="pt-3 flex justify-end gap-3">
							<VscodeButton onClick={() => setRunDialogOpen(false)}>取消</VscodeButton>
							<VscodeButton onClick={executeScript} disabled={running}>
								<Play size={16} />
								执行
							</VscodeButton>
						</div>
					</Dialog.Content>
				</Dialog.Root>

				{/* Node Selector Dialog */}
				{nodePickerOpen && (
					<NodeSelectorDialog
						open={nodePickerOpen}
						onOpenChange={setNodePickerOpen}
						value={runClients}
						onChange={setRunClients}
						title="选择运行节点"
						showViewModeToggle
						defaultViewMode="group"
					/>
				)}

				{/* Config Client Dialog */}
				{configClientDialogOpen && (
					<NodeSelectorDialog
						open={configClientDialogOpen}
						onOpenChange={setConfigClientDialogOpen}
						value={configClientsSelection}
						onChange={val => {
							setConfigClientsSelection(val)
							if (configClientTarget) {
								setScripts(prev => prev.map(s => (s.id === configClientTarget.id ? { ...s, clients: val } : s)))
								setDirty(prev => ({ ...prev, [configClientTarget.id]: true }))
							}
						}}
						title="选择绑定节点（脚本默认）"
						showViewModeToggle
						defaultViewMode="group"
					/>
				)}

				{/* Input Dialog */}
				{inputDialog && (
					<Dialog.Root open={inputDialog.open} onOpenChange={open => !open && setInputDialog(null)}>
						<Dialog.Content style={{ maxWidth: 450 }} className="bg-white dark:bg-vscode-bg border border-gray-300 dark:border-vscode-border">
							<Dialog.Title className="text-gray-800 dark:text-vscode-foreground">{inputDialog.title}</Dialog.Title>
							<div className="py-3">
								<VscodeInput
									defaultValue={inputDialog.defaultValue}
									placeholder="请输入..."
									autoFocus
									id="input-dialog-field"
									onKeyDown={e => {
										if (e.key === 'Enter') {
											const value = (e.target as HTMLInputElement).value
											inputDialog.onConfirm(value)
										}
									}}
								/>
							</div>
							<div className="pt-3 flex justify-end gap-3">
								<VscodeButton onClick={() => setInputDialog(null)}>取消</VscodeButton>
								<VscodeButton
									onClick={() => {
										const input = document.getElementById('input-dialog-field') as HTMLInputElement
										if (input) inputDialog.onConfirm(input.value)
									}}>
									确定
								</VscodeButton>
							</div>
						</Dialog.Content>
					</Dialog.Root>
				)}

				{/* Confirm Dialog */}
				{confirmDialog && (
					<Dialog.Root open={confirmDialog.open} onOpenChange={open => !open && setConfirmDialog(null)}>
						<Dialog.Content style={{ maxWidth: 400 }} className="bg-white dark:bg-vscode-bg border border-gray-300 dark:border-vscode-border">
							<Dialog.Title className="text-gray-800 dark:text-vscode-foreground">确认操作</Dialog.Title>
							<div className="py-3">
								<span className="text-gray-800 dark:text-vscode-foreground">{confirmDialog.message}</span>
							</div>
							<div className="pt-3 flex justify-end gap-3">
								<VscodeButton onClick={() => setConfirmDialog(null)}>取消</VscodeButton>
								<VscodeButton onClick={confirmDialog.onConfirm}>确定</VscodeButton>
							</div>
						</Dialog.Content>
					</Dialog.Root>
				)}
			</div>
		</NodeDetailsProvider>
	)
}

const ScriptWorkbenchPage = () => (
	<NodeDetailsProvider>
		<ScriptWorkbench />
	</NodeDetailsProvider>
)

export default ScriptWorkbenchPage