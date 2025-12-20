import { useEffect, useMemo, useRef, useState, type FC } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { apiService, buildLgSignature } from '@/services/api'
import { useLiveData } from '@/contexts/LiveDataContext'
import { useIsMobile } from '@/hooks/useMobile'
import { Play, Square, ShieldCheck, Link2, KeyRound, ArrowLeft } from 'lucide-react'
import Loading from '@/components/loading'
import { Terminal } from 'xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Link } from 'react-router-dom'
import 'xterm/css/xterm.css'
import Flag from '@/components/sections/Flag'

type LgNode = {
	auth_id: number
	auth_name: string
	auth_mode?: string
	node: {
		uuid: string
		name: string
		region?: string
		os?: string
		ipv4?: string
		ipv6?: string
	}
	tools: string[]
	expires_at?: string
	max_usage?: number
	used_count?: number
	remaining_uses?: number
	code?: string
}

type NodeGroup = {
	id: string
	label: string
	mode: 'public' | 'code'
	code?: string
	nodes: LgNode[]
}

const TOOL_OPTIONS = [
	{ key: 'ping', label: 'ping' },
	{ key: 'tcping', label: 'tcping' },
	{ key: 'mtr', label: 'mtr' },
	{ key: 'nexttrace', label: 'nexttrace' },
	{ key: 'iperf3', label: 'iperf3' },
	{ key: 'speedtest', label: 'speedtest' }
]

type HistoryItem = {
	id: string
	node: string
	tool: string
	input: string
	timestamp: number
	output: string
}

const HISTORY_KEY = 'lg_history'

const ipv4Pattern = /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/
const ipv6Pattern =
	/^\[?((?:[A-Fa-f0-9]{1,4}:){7}[A-Fa-f0-9]{1,4}|(?:[A-Fa-f0-9]{1,4}:){1,7}:|(?:[A-Fa-f0-9]{1,4}:){1,6}:[A-Fa-f0-9]{1,4}|(?:[A-Fa-f0-9]{1,4}:){1,5}(?::[A-Fa-f0-9]{1,4}){1,2}|(?:[A-Fa-f0-9]{1,4}:){1,4}(?::[A-Fa-f0-9]{1,4}){1,3}|(?:[A-Fa-f0-9]{1,4}:){1,3}(?::[A-Fa-f0-9]{1,4}){1,4}|(?:[A-Fa-f0-9]{1,4}:){1,2}(?::[A-Fa-f0-9]{1,4}){1,5}|[A-Fa-f0-9]{1,4}:(?:(?::[A-Fa-f0-9]{1,4}){1,6})|:(?:(?::[A-Fa-f0-9]{1,4}){1,7}|:))\]?$/
const domainLabelPattern = /^[a-z0-9-]+$/i
const digitsPattern = /^\d+$/

const isValidDomain = (value: string) => {
	const trimmed = value.trim().toLowerCase()
	if (!trimmed || trimmed.length > 253 || !trimmed.includes('.')) return false
	const labels = trimmed.split('.')
	if (labels.length < 2) return false
	return labels.every(label => {
		if (!label || label.length > 63) return false
		if (label.startsWith('-') || label.endsWith('-')) return false
		return domainLabelPattern.test(label)
	})
}

const isValidHost = (value: string) => {
	const trimmed = value.trim()
	if (!trimmed) return false
	return ipv4Pattern.test(trimmed) || ipv6Pattern.test(trimmed) || isValidDomain(trimmed)
}

const validateLgInput = (tool: string, rawInput: string): { value: string; error?: string } => {
	const normalizedTool = tool.trim().toLowerCase()
	const input = rawInput.split(/\s+/).filter(Boolean).join(' ').trim()

	switch (normalizedTool) {
		case 'iperf3':
			return { value: '' }
		case 'speedtest':
			if (!input) return { value: '', error: 'Speedtest 需要输入服务器编号（纯数字）' }
			if (!digitsPattern.test(input)) return { value: '', error: 'Speedtest 仅允许输入纯数字的服务器编号' }
			return { value: input }
		case 'tcping': {
			if (!input) return { value: '', error: 'tcping 需要提供目标地址' }
			const parts = input.split(/\s+/).filter(Boolean)
			if (parts.length > 2) return { value: '', error: 'tcping 仅支持“目标 [端口]”格式' }
			const host = parts[0]
			if (!isValidHost(host)) return { value: '', error: '请输入有效的 IP 或域名' }
			if (parts.length === 1) return { value: host }
			const portStr = parts[1]
			const port = Number(portStr)
			if (!digitsPattern.test(portStr) || port < 1 || port > 65535) return { value: '', error: '端口必须为 1-65535 的数字' }
			return { value: `${host} ${portStr}` }
		}
		case 'ping':
		case 'mtr':
		case 'nexttrace': {
			if (!input) return { value: '', error: `${normalizedTool} 需要提供 IP 或域名` }
			if (input.split(/\s+/).length !== 1) return { value: '', error: `${normalizedTool} 仅支持单个 IP/域名` }
			if (!isValidHost(input)) return { value: '', error: `${normalizedTool} 仅允许输入 IP（IPv4/IPv6）或域名` }
			return { value: input }
		}
		default:
			return { value: input }
	}
}

// 历史记录终端组件
const HistoryTerminal: FC<{ output: string }> = ({ output }) => {
	const containerRef = useRef<HTMLDivElement>(null)
	const termRef = useRef<Terminal | null>(null)

	useEffect(() => {
		if (!containerRef.current || termRef.current) return

		const term = new Terminal({
			fontSize: 12,
			convertEol: true,
			disableStdin: true,
			cursorBlink: false,
			rows: 8,
			theme: { background: '#0b0b0b', foreground: '#d1ffd7' }
		})
		const fitAddon = new FitAddon()
		term.loadAddon(fitAddon)
		term.open(containerRef.current)
		fitAddon.fit()
		term.write(output.replace(/\r?\n/g, '\r\n'))
		termRef.current = term

		return () => {
			fitAddon.dispose()
			term.dispose()
			termRef.current = null
		}
	}, [output])

	return <div ref={containerRef} className="h-32" />
}

const LookingGlassPage = () => {
	const { liveData } = useLiveData()
	const isMobile = useIsMobile()
	const [loading, setLoading] = useState(true)
	const [groups, setGroups] = useState<NodeGroup[]>([])
	const [selectedGroup, setSelectedGroup] = useState<string>('')
	const [selectedNode, setSelectedNode] = useState<string>('')
	const [tool, setTool] = useState('ping')
	const [inputValue, setInputValue] = useState('')
	const logsRef = useRef<string[]>([])
	const wsRef = useRef<WebSocket | null>(null)
	const [running, setRunning] = useState(false)
	const [history, setHistory] = useState<HistoryItem[]>([])
	const historyRef = useRef<HistoryItem[]>([])
	const [codeInput, setCodeInput] = useState('')
	const terminalRef = useRef<Terminal | null>(null)
	const fitAddonRef = useRef<FitAddon | null>(null)
	const terminalContainerRef = useRef<HTMLDivElement | null>(null)

	useEffect(() => {
		const stored = localStorage.getItem(HISTORY_KEY)
		if (stored) {
			try {
				const parsed: HistoryItem[] = JSON.parse(stored)
				setHistory(parsed)
				historyRef.current = parsed
			} catch {
				// ignore
			}
		}
	}, [])

	useEffect(() => {
		if (loading) return
		if (terminalRef.current || !terminalContainerRef.current) return

		const term = new Terminal({
			fontSize: 13,
			convertEol: true,
			disableStdin: true,
			cursorBlink: false,
			theme: { background: '#0b0b0b', foreground: '#d1ffd7' }
		})
		const fitAddon = new FitAddon()
		term.loadAddon(fitAddon)
		term.open(terminalContainerRef.current)
		fitAddon.fit()
		terminalRef.current = term
		fitAddonRef.current = fitAddon

		const onResize = () => requestAnimationFrame(() => fitAddon.fit())
		window.addEventListener('resize', onResize)

		return () => {
			window.removeEventListener('resize', onResize)
			fitAddon.dispose()
			term.dispose()
			terminalRef.current = null
			fitAddonRef.current = null
		}
	}, [loading])

	// 视图变化时强制 fit，避免 0 宽造成不显示
	useEffect(() => {
		if (fitAddonRef.current) {
			requestAnimationFrame(() => fitAddonRef.current?.fit())
		}
	}, [isMobile, selectedGroup, selectedNode, running])

	const saveHistory = (items: HistoryItem[]) => {
		const next = items.slice(0, 30)
		historyRef.current = next
		setHistory(next)
		localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
	}

	const clearHistory = () => {
		historyRef.current = []
		setHistory([])
		localStorage.removeItem(HISTORY_KEY)
	}

	const buildPublicGroup = (data: any[]): NodeGroup => ({
		id: 'public',
		label: '公共',
		mode: 'public',
		nodes: (data || [])
			.map((n: any) => ({ ...n, auth_mode: 'public' }))
			.sort((a: LgNode, b: LgNode) => a.node.name.localeCompare(b.node.name, 'zh-CN'))
	})

	const buildCodeGroup = (code: string, payload: any): NodeGroup | null => {
		const auth = payload?.data?.auth || payload?.auth
		const nodes = payload?.data?.nodes || payload?.nodes
		if (!auth || !nodes) return null
		const authName = auth?.name || '授权节点'
		return {
			id: `code-${code}`,
			label: authName,
			mode: 'code',
			code,
			nodes: nodes
				.map((n: any) => ({ ...n, auth_mode: 'code', code, auth_name: authName }))
				.sort((a: LgNode, b: LgNode) => a.node.name.localeCompare(b.node.name, 'zh-CN'))
		}
	}

	const refreshGroupUsage = async (group?: NodeGroup) => {
		if (!group) return
		try {
			if (group.mode === 'public') {
				const data = await apiService.getPublicLgNodes()
				const pubGroup = buildPublicGroup(data || [])
				setGroups(prev => {
					const others = prev.filter(g => g.id !== 'public')
					return [pubGroup, ...others]
				})
				if (selectedGroup === 'public' && pubGroup.nodes.length > 0) {
					const exists = pubGroup.nodes.some(n => n.node.uuid === selectedNode)
					if (!exists) {
						setSelectedNode(pubGroup.nodes[0].node.uuid)
					}
				}
			} else if (group.mode === 'code' && group.code) {
				const data = await apiService.verifyLgCode(group.code)
				if (!data || data.status === 'error') return
				const nextGroup = buildCodeGroup(group.code, data)
				if (!nextGroup) return
				setGroups(prev => {
					const others = prev.filter(g => g.id !== nextGroup.id)
					return [...others, nextGroup]
				})
				if (selectedGroup === nextGroup.id && nextGroup.nodes.length > 0) {
					const exists = nextGroup.nodes.some(n => n.node.uuid === selectedNode)
					if (!exists) {
						setSelectedNode(nextGroup.nodes[0].node.uuid)
					}
				}
			}
		} catch (err) {
			console.error('刷新节点使用次数失败', err)
		}
	}

	const applyRemainingUseDelta = (authId: number, mode: string, code: string | undefined, delta: number) => {
		setGroups(prev =>
			prev.map(g => {
				if (g.mode !== mode) return g
				if (mode === 'code' && code && g.code !== code) return g
				const nodes = g.nodes.map(n => {
					if (n.auth_id !== authId) return n
					if (typeof n.remaining_uses !== 'number') return n
					const next = Math.max(0, n.remaining_uses + delta)
					return { ...n, remaining_uses: next }
				})
				return { ...g, nodes }
			})
		)
	}

	useEffect(() => {
		let active = true
		apiService
			.getPublicLgNodes()
			.then(data => {
				if (!active) return
				const pubGroup = buildPublicGroup(data || [])
				setGroups(prev => [pubGroup, ...prev.filter(g => g.id !== 'public')])
				if (!selectedGroup && pubGroup.nodes.length > 0) {
					setSelectedGroup('public')
					setSelectedNode(pubGroup.nodes[0].node.uuid)
				}
			})
			.finally(() => {
				if (active) setLoading(false)
			})
		return () => {
			active = false
		}
	}, [])

	const onlineSet = useMemo(() => new Set(liveData?.online || []), [liveData])

	const currentGroup = useMemo(() => groups.find(g => g.id === selectedGroup), [groups, selectedGroup])
	const currentNode = useMemo(() => {
		const group = groups.find(g => g.id === selectedGroup)
		return group?.nodes.find(n => n.node.uuid === selectedNode)
	}, [groups, selectedGroup, selectedNode])
	const allowedTools = currentNode?.tools || []
	const isToolAllowed = !currentNode || allowedTools.length === 0 || allowedTools.includes(tool)
	const startDisabled = running || !currentNode || !onlineSet.has(currentNode?.node.uuid || '') || !isToolAllowed

	const appendLog = (text: string) => {
		const safe = text.endsWith('\n') ? text : `${text}\n`
		if (terminalRef.current) {
			terminalRef.current.write(safe.replace(/\r?\n/g, '\r\n'))
		}
		logsRef.current = [...logsRef.current, safe]
	}

	const startSession = async () => {
		if (!currentNode) {
			appendLog('请选择节点')
			return
		}
		if (allowedTools.length > 0 && !allowedTools.includes(tool)) {
			appendLog('该节点授权不允许此工具')
			return
		}
		if (!onlineSet.has(currentNode.node.uuid)) {
			appendLog('节点不在线')
			return
		}

		const { value: actualInput, error: inputError } = validateLgInput(tool, inputValue)
		if (inputError) {
			appendLog(inputError)
			return
		}

		setRunning(true)
		logsRef.current = []
		if (terminalRef.current) {
			terminalRef.current.reset()
			if (fitAddonRef.current) {
				fitAddonRef.current.fit()
			}
		}
		const groupForUpdate = currentGroup
		try {
			const payload = {
				uuid: currentNode.node.uuid,
				tool: tool,
				input: actualInput,
				auth_id: currentNode.auth_id,
				mode: currentNode.auth_mode || 'public',
				code: currentNode.code || ''
			}
			const resp = await apiService.startLgSession(payload as any)
			const respData = (resp as any).data?.data || (resp as any).data || resp
			const { session_id } = respData
			if (!session_id) throw new Error('missing session id')

			applyRemainingUseDelta(currentNode.auth_id, currentNode.auth_mode || 'public', currentNode.code, -1)
			void refreshGroupUsage(groupForUpdate)

			const sig = await buildLgSignature(session_id)
			let wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/api/lg/session/ws?id=${encodeURIComponent(
				session_id
			)}`
			if (sig.query) {
				wsUrl += `&${sig.query}`
			}
			const ws = new WebSocket(wsUrl)
			wsRef.current = ws
			ws.onmessage = ev => {
				const text = typeof ev.data === 'string' ? ev.data : ''
				appendLog(text)
			}
			ws.onerror = () => {
				appendLog('[连接错误]')
				setRunning(false)
				wsRef.current = null
			}
			ws.onclose = () => {
				setRunning(false)
				wsRef.current = null
				if (logsRef.current.length > 0) {
					const item: HistoryItem = {
						id: `${Date.now()}`,
						node: currentNode.node.name,
						tool,
						input: actualInput,
						timestamp: Date.now(),
						output: logsRef.current.join('')
					}
					saveHistory([item, ...historyRef.current])
				}
			}
			ws.onerror = () => {
				appendLog('[连接错误]')
			}
		} catch (err: any) {
			appendLog(err?.message || '启动失败')
			setRunning(false)
		}
	}

	const stopSession = () => {
		if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
			wsRef.current.send(JSON.stringify({ type: 'stop' }))
			wsRef.current.close()
		}
		setRunning(false)
	}

	const handleVerifyCode = async () => {
		if (!codeInput.trim()) return
		const data = await apiService.verifyLgCode(codeInput.trim())
		if (!data || data.status === 'error') {
			appendLog(data?.message || '授权码验证失败')
			return
		}
		const group = buildCodeGroup(codeInput.trim(), data)
		if (!group) {
			appendLog('授权码验证失败')
			return
		}
		setGroups(prev => {
			const others = prev.filter(g => g.id !== group.id)
			return [...others, group]
		})
		setSelectedGroup(group.id)
		if (group.nodes.length > 0) {
			setSelectedNode(group.nodes[0].node.uuid)
		}
		setCodeInput('')
	}

	if (loading) {
		return <Loading text="正在加载 Looking Glass..." />
	}

	return (
		<div className="w-[90%] max-w-screen-2xl mx-auto flex flex-col text-secondary-foreground pb-15 p-4 space-y-4" style={{ height: 'calc(100vh - 53px)' }}>
			{/* 页面标题 */}
			<div className="flex flex-col md:flex-row items-start md:items-center justify-between purcarte-blur theme-card-style p-4 gap-3 mb-4 shrink-0">
				<div className="flex items-start gap-3">
					<Link to="/" className="p-4 rounded hover:bg-(--gray-3) transition-colors">
						<ArrowLeft className="size-4" />
					</Link>
					<div>
						<div className="flex items-center gap-2 text-lg font-bold">
							<Link2 className="size-5 text-primary" />
							<span>Looking Glass</span>
						</div>
						<p className="text-sm text-secondary-foreground mt-1">
							网络诊断工具，支持 ping / mtr / tcping / nexttrace 等，可联系 管理员 获取更多节点、可用工具的授权码。
						</p>
					</div>
				</div>
			</div>

			<div className="flex flex-col lg:flex-row gap-4 flex-1 overflow-hidden">
				{/* 左侧：节点选择 */}
				<Card className="w-full lg:w-80 shrink-0 purcarte-blur theme-card-style border border-(--accent-a6)/40 flex flex-col overflow-hidden">
					<CardHeader className="pb-3 shrink-0">
						<CardTitle className="flex items-center gap-2 text-primary text-base mb-3">
							<ShieldCheck className="size-5" />
							<span>可用节点</span>
						</CardTitle>
						{/* 授权码输入 */}
						<div className="flex items-center gap-2">
							<Input
								placeholder="输入授权码"
								value={codeInput}
								onChange={e => setCodeInput(e.target.value)}
								className="text-sm"
								onKeyDown={e => e.key === 'Enter' && handleVerifyCode()}
							/>
							<Button size="sm" onClick={handleVerifyCode} disabled={!codeInput.trim()}>
								<KeyRound className="size-3.5" />
							</Button>
						</div>
					</CardHeader>
					<CardContent className="flex-1 overflow-y-auto nice-scrollbar pr-2 space-y-3">
						{groups.map(group => (
							<div key={group.id} className="space-y-1.5">
								<div className="text-[11px] font-semibold text-primary/70 px-1">{group.label}</div>
								<div className="space-y-1">
									{group.nodes.map(n => {
										const isOnline = onlineSet.has(n.node.uuid)
										const disabled = !isOnline
										const active = selectedGroup === group.id && selectedNode === n.node.uuid
										return (
											<button
												key={n.node.uuid + group.id}
												onClick={() => {
													setSelectedGroup(group.id)
													setSelectedNode(n.node.uuid)
												}}
												disabled={disabled}
												className={`w-full text-left px-3 py-2 rounded-lg border transition-all duration-200 ${
													active
														? 'border-primary bg-(--accent-a5)/60 shadow-sm'
														: 'border-(--accent-a5)/40 hover:border-(--accent-a6)/60'
												} ${disabled ? 'opacity-40 cursor-not-allowed' : 'hover:shadow-sm'}`}>
												<div className="flex items-center gap-2">
													<div
														className={`size-2 rounded-full shrink-0 ${
															isOnline ? 'bg-green-500 shadow-sm shadow-green-500/50' : 'bg-gray-400'
														}`}
													/>
													<Flag flag={n.node.region || 'UN'} />
													<span className={`font-medium text-sm ${active ? 'text-primary' : ''}`}>{n.node.name}</span>
												</div>
												{n.remaining_uses !== undefined && n.remaining_uses !== null && (
													<div className="text-[11px] opacity-60 mt-1 ml-4">剩余 {n.remaining_uses} 次</div>
												)}
											</button>
										)
									})}
								</div>
							</div>
						))}
						{groups.length === 0 && <div className="text-sm opacity-70 text-center py-4">暂无可用节点</div>}
					</CardContent>
				</Card>

				{/* 右侧：操作和历史 */}
				<div className="flex-1 flex flex-col gap-4 overflow-hidden">
					{/* 操作面板 */}
					<Card className="purcarte-blur theme-card-style border border-(--accent-a6)/40 flex flex-col overflow-hidden" style={{ flex: '2 1 0%' }}>
						<CardHeader className="pb-3 shrink-0">
							<CardTitle className="flex items-center gap-2 text-base">
								<Play className="size-5 text-primary" />
								<span>操作面板</span>
								{currentNode && (
									<div className="text-xs font-normal opacity-80 ml-auto flex flex-col items-end gap-1">
										<div className="flex items-center gap-2">
											<Flag flag={currentNode.node.region || 'UN'} />
											<span className="font-semibold text-primary">{currentNode.node.name}</span>
										</div>
										<div className="flex flex-wrap gap-2 justify-end">
											{typeof currentNode.remaining_uses === 'number' && <span>剩余 {currentNode.remaining_uses} 次</span>}
											{currentNode.expires_at && <span>有效期 {new Date(currentNode.expires_at).toLocaleString()}</span>}
											{currentNode.tools?.length ? <span>允许工具: {currentNode.tools.join(', ')}</span> : null}
										</div>
									</div>
								)}
							</CardTitle>
						</CardHeader>
						<CardContent className="flex-1 flex flex-col gap-3 overflow-hidden">
							{/* 工具和输入 */}
							<div className="grid grid-cols-12 gap-2 shrink-0">
								<div className="col-span-12 md:col-span-2">
									<label className="text-xs font-medium opacity-70 mb-1 block">工具</label>
									<select
										value={tool}
										onChange={e => setTool(e.target.value)}
										className="w-full rounded-lg bg-(--accent-a3)/50 border border-(--accent-a6)/60 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition">
										{TOOL_OPTIONS.map(opt => {
											const disabled = currentNode ? allowedTools.length > 0 && !allowedTools.includes(opt.key) : false
											return (
												<option key={opt.key} value={opt.key} disabled={disabled}>
													{opt.label}
												</option>
											)
										})}
									</select>
								</div>
								<div className="col-span-12 md:col-span-6">
									<label className="text-xs font-medium opacity-70 mb-1 block">目标地址</label>
									<Input
										value={inputValue}
										disabled={tool === 'iperf3'}
										onChange={e => setInputValue(e.target.value)}
										onKeyDown={e => {
											if (e.key === 'Enter' && !startDisabled) {
												startSession()
											}
										}}
										placeholder={
											tool === 'tcping'
												? 'example.com 12345 (未填写端口时，默认:80)'
												: tool === 'speedtest'
												? '服务器ID（仅数字）'
												: tool === 'iperf3'
												? '自动获取'
												: 'example.com 或 IP'
										}
										className="text-sm"
									/>
								</div>
								<div className="col-span-12 md:col-span-4 flex flex-col">
									<label className="text-xs font-medium opacity-70 mb-1 block">操作</label>
									<div className="flex gap-2">
										<Button disabled={startDisabled} onClick={startSession} className="flex-1" size="default">
											<Play className="size-4 mr-1.5" />
											开始测试
										</Button>
										<Button variant="outline" disabled={!running} onClick={stopSession} size="default">
											<Square className="size-4 mr-1.5" />
											停止
										</Button>
									</div>
								</div>
							</div>

							{/* 日志输出 */}
							<div className="flex-1 flex flex-col overflow-hidden">
								<label className="text-xs font-medium opacity-70 mb-1 block shrink-0">输出日志</label>
								<div className="flex-1 rounded-lg border border-(--accent-a6)/50 bg-black/60 p-3 overflow-hidden nice-scrollbar">
									<div ref={terminalContainerRef} className="h-full w-full" />
								</div>
							</div>
						</CardContent>
					</Card>

					{/* 历史记录 */}
					<Card className="purcarte-blur theme-card-style border border-(--accent-a6)/40 flex flex-col overflow-hidden" style={{ flex: '1 1 0%' }}>
						<CardHeader className="pb-2 shrink-0">
							<CardTitle className="flex items-center gap-2 text-base w-full">
								<div className="flex items-center gap-2">
									<HistoryIcon />
									<span>执行历史</span>
									{history.length > 0 && <span className="text-xs font-normal opacity-70">最近 {history.length} 条</span>}
								</div>
								<Button variant="ghost" size="sm" className="text-xs px-2 py-1 ml-auto" disabled={history.length === 0} onClick={clearHistory}>
									清空
								</Button>
							</CardTitle>
						</CardHeader>
						<CardContent className="flex-1 overflow-y-auto nice-scrollbar space-y-2 pr-1">
							{history.length === 0 ? (
								<div className="text-base font-semibold opacity-75 text-center py-10 tracking-wide">暂无执行记录</div>
							) : (
								history.map(item => (
									<div
										key={item.id}
										className="border border-(--accent-a5)/30 rounded-lg p-3 hover:border-(--accent-a6)/50 transition-colors">
										<div className="flex items-center justify-between mb-1.5">
											<div className="flex items-center gap-2 flex-1 min-w-0">
												<Flag
													flag={
														groups
															.find(g => g.nodes.some(n => n.node.name === item.node))
															?.nodes.find(n => n.node.name === item.node)?.node.region || 'UN'
													}
												/>
												<span className="font-semibold text-sm text-primary truncate">{item.node}</span>
												<span className="text-xs opacity-80 font-mono bg-(--accent-a3)/50 px-1.5 py-0.5 rounded shrink-0">
													{item.tool}
												</span>
												{item.input && <span className="text-xs opacity-70 truncate">{item.input}</span>}
											</div>
											<span className="text-xs opacity-60 shrink-0 ml-2">{new Date(item.timestamp).toLocaleString()}</span>
										</div>
										<div className="rounded overflow-hidden border border-(--accent-a6)/30">
											<HistoryTerminal output={item.output} />
										</div>
									</div>
								))
							)}
						</CardContent>
					</Card>
				</div>
			</div>
		</div>
	)
}

const HistoryIcon = () => (
	<svg className="size-5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
		<path d="M12 6v6l4 2" />
		<path d="M3 12a9 9 0 1 0 3-7" />
		<path d="M3 3v4h4" />
	</svg>
)

export default LookingGlassPage
