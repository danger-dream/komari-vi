import { useEffect, useMemo, useRef, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Brush, ReferenceLine } from 'recharts'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import Tips from '@/components/ui/tips'
import { Label } from '@radix-ui/react-label'
import { ArrowLeft, ArrowRightToLine, Eye, EyeOff, RefreshCw, Server, SignalHigh, ClipboardList, Globe, Layers, List, ChevronDown, ChevronRight, Search } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useNodeData } from '@/contexts/NodeDataContext'
import { usePingTasks } from '@/hooks/usePingTasks'
import { useTaskPingHistory } from '@/hooks/useTaskPingHistory'
import type { NodeData, PingTask } from '@/types/node'
import PingChart from '@/pages/instance/PingChart'
import { useIsMobile } from '@/hooks/useMobile'
import { useAppConfig, useConfigItem } from '@/config'
import Loading from '@/components/loading'
import fillMissingTimePoints, { cutPeakValues } from '@/utils/RecordHelper'
import { CustomTooltip as ChartTooltip } from '@/components/ui/tooltip'
import { generateColor, lableFormatter } from '@/utils/chartHelper'
import Flag from '@/components/sections/Flag'
import { getRegionDisplayName, sortByRegionPriority } from '@/utils/regionHelper'

type GroupMode = 'none' | 'region' | 'group'

type TimeRangeOption = { label: string; hours: number }

const buildPingRanges = (maxHours: number): TimeRangeOption[] => {
	const base: TimeRangeOption[] = [
		{ label: '实时', hours: 0 },
		{ label: '1小时', hours: 1 },
		{ label: '6小时', hours: 6 },
		{ label: '12小时', hours: 12 },
		{ label: '1天', hours: 24 },
		{ label: '7天', hours: 168 },
		{ label: '30天', hours: 720 }
	]
	const filtered = base.filter(range => range.hours === 0 || range.hours <= maxHours)
	if (maxHours > 720) {
		filtered.push({ label: `${maxHours}小时`, hours: maxHours })
	}
	return filtered
}

const LatencyMonitor = () => {
	const { nodes, publicSettings, loading: nodesLoading } = useNodeData()
	const { tasks, loading: taskLoading, error: taskError } = usePingTasks()
	const [mode, setMode] = useState<'task' | 'server'>('task')
	const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null)
	const [selectedNodeId, setSelectedNodeId] = useState<string>('')
	const [taskHours, setTaskHours] = useState<number>(1)
	const [serverHours, setServerHours] = useState<number>(1)

	const pingPreserveTime = publicSettings?.ping_record_preserve_time || 24
	const pingRanges = useMemo(() => buildPingRanges(pingPreserveTime), [pingPreserveTime])
	const nodeList = Array.isArray(nodes) ? nodes : []

	useEffect(() => {
		if (tasks.length > 0 && !selectedTaskId) {
			setSelectedTaskId(tasks[0].id)
		}
	}, [tasks, selectedTaskId])

	useEffect(() => {
		if (nodeList.length > 0 && !selectedNodeId) {
			setSelectedNodeId(nodeList[0].uuid)
		}
	}, [nodeList, selectedNodeId])

	const selectedNode = useMemo<NodeData | null>(() => {
		return nodeList.find(n => n.uuid === selectedNodeId) || null
	}, [nodeList, selectedNodeId])

	if (nodesLoading) {
		return (
			<div className="flex items-center justify-center h-full">
				<Loading text="正在加载延迟监控..." />
			</div>
		)
	}

	return (
		<div className="w-[90%] max-w-screen-2xl text-card-foreground mx-auto flex-1 flex flex-col pb-15 p-4 space-y-4">
			<div className="flex flex-col md:flex-row items-start md:items-center justify-between purcarte-blur theme-card-style p-4 gap-3">
				<div className="flex items-start gap-3">
					<Link to="/" className="p-4 rounded hover:bg-(--gray-3) transition-colors">
						<ArrowLeft className="size-4" />
					</Link>
					<div>
						<div className="flex items-center gap-2 text-lg font-bold">
							<SignalHigh className="size-5 text-primary" />
							<span>延迟监控</span>
						</div>
						<p className="text-sm text-secondary-foreground mt-1">任务视角 / 服务器视角，全量复用延迟图表体验</p>
						{taskError && <p className="text-xs text-destructive mt-1">任务列表加载失败：{taskError}</p>}
					</div>
				</div>
				<div className="flex flex-wrap gap-2">
					<Button variant={mode === 'task' ? 'secondary' : 'ghost'} size="sm" onClick={() => setMode('task')} className="gap-1">
						<ClipboardList className="size-4" />
						任务模式
					</Button>
					<Button variant={mode === 'server' ? 'secondary' : 'ghost'} size="sm" onClick={() => setMode('server')} className="gap-1">
						<Server className="size-4" />
						服务器模式
					</Button>
				</div>
			</div>

			{mode === 'task' ? (
				<TaskModeSection
					tasks={tasks}
					loading={taskLoading}
					selectedTaskId={selectedTaskId}
					onSelectTask={setSelectedTaskId}
					hours={taskHours}
					onChangeHours={setTaskHours}
					timeRanges={pingRanges}
					nodes={nodeList}
				/>
			) : (
				<ServerModeSection
					nodes={nodeList}
					selectedNode={selectedNode}
					onSelectNode={setSelectedNodeId}
					hours={serverHours}
					onChangeHours={setServerHours}
					timeRanges={pingRanges}
				/>
			)}
		</div>
	)
}

const TaskModeSection = ({
	tasks,
	loading,
	selectedTaskId,
	onSelectTask,
	hours,
	onChangeHours,
	timeRanges,
	nodes
}: {
	tasks: PingTask[]
	loading: boolean
	selectedTaskId: number | null
	onSelectTask: (id: number) => void
	hours: number
	onChangeHours: (hours: number) => void
	timeRanges: TimeRangeOption[]
	nodes: NodeData[]
}) => {
	const { history, loading: historyLoading, error } = useTaskPingHistory(selectedTaskId, hours)
	const [visibleClients, setVisibleClients] = useState<string[]>([])
	const [timeRange, setTimeRange] = useState<[number, number] | null>(null)
	const [brushIndices, setBrushIndices] = useState<{ startIndex?: number; endIndex?: number }>({})
	const [cutPeak, setCutPeak] = useState(false)
	const [connectBreaks, setConnectBreaks] = useState(useConfigItem('enableConnectBreaks'))
	const [isResetting, setIsResetting] = useState(false)
	const [sortKey, setSortKey] = useState<'default' | 'name' | 'latency' | 'loss'>('default')
	const [lossFilter, setLossFilter] = useState<'all' | 'loss' | 'no_loss'>('all')
	const maxPointsToRender = useConfigItem('pingChartMaxPoints') || 0 // 0 表示不限制
	const isMobile = useIsMobile()
	const selectedTask = tasks.find(t => t.id === selectedTaskId) || null
	const prevTaskIdRef = useRef<number | null>(null)

	const nodeInfoMap = useMemo(() => {
		return nodes.reduce<Record<string, { name: string; region: string; group: string; weight: number }>>((acc, node) => {
			acc[node.uuid] = { name: node.name, region: node.region, group: node.group, weight: node.weight }
			return acc
		}, {})
	}, [nodes])

	const [groupMode, setGroupMode] = useState<GroupMode>('none')
	const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
	const [taskSearch, setTaskSearch] = useState('')
	const [nodeSearch, setNodeSearch] = useState('')

	const clientEntries = useMemo(() => {
		const set = new Set<string>()
		selectedTask?.clients?.forEach(c => set.add(c))
		history?.records?.forEach(rec => {
			if (rec.client) set.add(rec.client)
		})
		// 只保留在 nodeInfoMap 中存在的节点
		return Array.from(set)
			.filter(id => nodeInfoMap[id]) // 过滤掉已删除的节点
			.map(id => ({
				id,
				name: nodeInfoMap[id].name,
				region: nodeInfoMap[id].region,
				group: nodeInfoMap[id].group,
				weight: nodeInfoMap[id].weight
			}))
			.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
	}, [history?.records, nodeInfoMap, selectedTask?.clients])

	// 筛选任务
	const filteredTasks = useMemo(() => {
		if (!taskSearch.trim()) return tasks
		const search = taskSearch.toLowerCase()
		return tasks.filter(task => task.name.toLowerCase().includes(search))
	}, [tasks, taskSearch])

	const colorPalette: PingTask[] = useMemo(() => {
		return clientEntries.map((client, index) => ({
			id: index + 1,
			name: client.name,
			interval: selectedTask?.interval || 60
		}))
	}, [clientEntries, selectedTask?.interval])

	const colorMap = useMemo(() => {
		const mapping: Record<string, string> = {}
		clientEntries.forEach((client, index) => {
			const pseudoTasks = colorPalette.length ? colorPalette : [{ id: index + 1, name: client.name, interval: 60 }]
			mapping[client.id] = generateColor(client.name, pseudoTasks)
		})
		return mapping
	}, [clientEntries, colorPalette])

	useEffect(() => {
		if (clientEntries.length === 0) return

		// 如果切换了任务，默认选中该任务的所有服务器
		if (selectedTaskId !== prevTaskIdRef.current) {
			setVisibleClients(clientEntries.map(c => c.id))
			prevTaskIdRef.current = selectedTaskId
			return
		}

		// 同一任务下，补齐新增的服务器
		setVisibleClients(prev => {
			const merged = new Set(prev)
			clientEntries.forEach(c => merged.add(c.id))
			return Array.from(merged)
		})
	}, [clientEntries, selectedTaskId])

	useEffect(() => {
		if (isResetting) {
			setTimeRange(null)
			setBrushIndices({})
			setIsResetting(false)
		}
	}, [isResetting])

	const chartMargin = { top: 8, right: 16, bottom: 8, left: 16 }

	const clientStats = useMemo(() => {
		if (!history?.records) return { items: [], total: 0 }
		const stats = clientEntries.map(client => {
			const records = history.records.filter(rec => rec.client === client.id)
			const filtered = timeRange
				? records.filter(rec => {
						const t = new Date(rec.time).getTime()
						return t >= timeRange[0] && t <= timeRange[1]
				  })
				: records
			const total = filtered.length
			const success = filtered.filter(rec => rec.value >= 0)
			const loss = total > 0 ? (1 - success.length / total) * 100 : 0
			let latestValue: number | null = null
			let latestTime: string | null = null
			if (success.length > 0) {
				const latest = success.reduce((prev, cur) => (new Date(cur.time) > new Date(prev.time) ? cur : prev))
				latestValue = latest.value
				latestTime = latest.time
			}
			return {
				...client,
				loss,
				value: latestValue,
				time: latestTime,
				color: colorMap[client.id]
			}
		})
		const filteredByLoss =
			lossFilter === 'loss' ? stats.filter(s => s.loss > 0) : lossFilter === 'no_loss' ? stats.filter(s => s.loss === 0) : stats

		const bySortKey = (a: (typeof stats)[number], b: (typeof stats)[number]) => {
			if (sortKey === 'default') {
				return (a.weight ?? 0) - (b.weight ?? 0) || a.name.localeCompare(b.name, 'zh-CN')
			}
			if (sortKey === 'latency') {
				const av = a.value ?? Infinity
				const bv = b.value ?? Infinity
				return av - bv || a.name.localeCompare(b.name, 'zh-CN')
			}
			if (sortKey === 'loss') {
				return b.loss - a.loss || a.name.localeCompare(b.name, 'zh-CN')
			}
			return a.name.localeCompare(b.name, 'zh-CN')
		}

		const sorted = [...filteredByLoss].sort(bySortKey)
		return { items: sorted, total: stats.length }
	}, [clientEntries, history?.records, timeRange, colorMap, lossFilter, sortKey])

	const allowedClientIds = useMemo(() => {
		if (lossFilter === 'all') return clientEntries.map(c => c.id)
		return clientStats.items.map(c => c.id)
	}, [clientEntries, clientStats.items, lossFilter])

	// 筛选节点
	const filteredClientStats = useMemo(() => {
		if (!nodeSearch.trim()) return clientStats
		const search = nodeSearch.toLowerCase()
		const filteredItems = clientStats.items.filter(client =>
			client.name.toLowerCase().includes(search)
		)
		return { items: filteredItems, total: clientStats.total }
	}, [clientStats, nodeSearch])

	// 分组数据
	const groupedClients = useMemo(() => {
		if (groupMode === 'none') {
			return [{ key: 'all', label: '', items: filteredClientStats.items }]
		}

		const groups: Record<string, typeof filteredClientStats.items> = {}

		for (const client of filteredClientStats.items) {
			const entry = clientEntries.find(c => c.id === client.id)
			let groupKey: string

			if (groupMode === 'region') {
				groupKey = entry?.region || 'unknown'
			} else {
				groupKey = entry?.group || 'default'
			}

			if (!groups[groupKey]) {
				groups[groupKey] = []
			}
			groups[groupKey].push(client)
		}

		// 分组排序：地域模式按优先级排序，分组模式按 weight 排序
		const sortedEntries = Object.entries(groups).sort((a, b) => {
			if (groupMode === 'region') {
				return sortByRegionPriority(a[0], b[0])
			} else {
				const minWeight = (items: typeof filteredClientStats.items) => {
					if (!items.length) return 0
					const val = items.reduce((min, it) => Math.min(min, it.weight ?? 0), Infinity)
					return val === Infinity ? 0 : val
				}
				return minWeight(a[1]) - minWeight(b[1])
			}
		})

		return sortedEntries.map(([key, items]) => {
			return {
				key,
				label: groupMode === 'region' ? getRegionDisplayName(key) : (key || '默认分组'),
				items
			}
		})
	}, [filteredClientStats.items, groupMode])

	const toggleGroupCollapse = (groupKey: string) => {
		setCollapsedGroups(prev => {
			const next = new Set(prev)
			if (next.has(groupKey)) {
				next.delete(groupKey)
			} else {
				next.add(groupKey)
			}
			return next
		})
	}

	// 同步可见列表与筛选结果，放大时自动全选，收缩时保留交集
	const prevAllowedRef = useRef<string[] | null>(null)
	useEffect(() => {
		setVisibleClients(prev => {
			const allowedSet = new Set(allowedClientIds)
			const next = prev.filter(id => allowedSet.has(id))
			const prevAllowed = prevAllowedRef.current || []
			const isExpanding = allowedClientIds.length > prevAllowed.length
			prevAllowedRef.current = allowedClientIds
			if (isExpanding) {
				return allowedClientIds // 扩大范围时默认全选
			}
			if (next.length === 0) {
				return allowedClientIds
			}
			return next
		})
	}, [allowedClientIds])

	const chartData = useMemo(() => {
		if (!history?.records || !selectedTask) return []

		const grouped: Record<number, any> = {}
		const timeKeys: number[] = []

		for (const rec of history.records) {
			if (rec.task_id !== selectedTask.id) continue
			const t = new Date(rec.time).getTime()
			let foundKey: number | null = null
			for (const key of timeKeys) {
				if (Math.abs(key - t) <= 5000) {
					foundKey = key
					break
				}
			}
			const useKey = foundKey !== null ? foundKey : t
			if (!grouped[useKey]) {
				grouped[useKey] = { time: useKey }
				if (foundKey === null) timeKeys.push(useKey)
			}
			const clientKey = rec.client || '未知'
			grouped[useKey][clientKey] = rec.value === -1 ? null : rec.value
		}

		let full = Object.values(grouped).sort((a: any, b: any) => a.time - b.time)

		if (hours !== 0) {
			const interval = selectedTask.interval || 60
			const maxGap = interval * 1.2
			const totalSeconds = hours * 60 * 60

			full = fillMissingTimePoints(full, interval, totalSeconds, maxGap).map((d: any) => ({
				...d,
				time: new Date(d.time).getTime()
			}))
		}

		if (maxPointsToRender > 0 && full.length > maxPointsToRender) {
			const factor = Math.ceil(full.length / maxPointsToRender)
			const reduced: any[] = []
			for (let i = 0; i < full.length; i += factor) {
				reduced.push(full[i])
			}
			full = reduced
		}

		if (cutPeak && clientEntries.length > 0) {
			const keys = clientEntries.map(c => c.id)
			full = cutPeakValues(full, keys)
		}

		const allowedSet = new Set(allowedClientIds)
		full = full.map((pt: any) => {
			const next: any = { time: pt.time }
			for (const key of Object.keys(pt)) {
				if (key === 'time') continue
				if (allowedSet.has(key)) {
					next[key] = pt[key]
				}
			}
			return next
		})

		return full
	}, [history?.records, selectedTask, hours, maxPointsToRender, cutPeak, clientEntries, allowedClientIds])

	// Break 空档标记在筛选后生效
	const breakPoints = useMemo(() => {
		if (!connectBreaks || !chartData || chartData.length < 2) {
			return []
		}
		const points: { x: number; color: string }[] = []
		const visitList = lossFilter === 'all' ? clientEntries : clientStats.items
		for (const client of visitList) {
			if (!visibleClients.includes(client.id)) continue
			for (let i = 1; i < chartData.length; i++) {
				const prev = chartData[i - 1]
				const current = chartData[i]
				const isBreak = (current[client.id] === null || current[client.id] === undefined) && prev[client.id] !== null && prev[client.id] !== undefined
				if (isBreak) {
					points.push({ x: current.time, color: colorMap[client.id] })
				}
			}
		}
		return points
	}, [chartData, clientEntries, connectBreaks, visibleClients, colorMap, lossFilter, clientStats.items])

	const handleToggleAll = () => {
		if (visibleClients.length === clientEntries.length) {
			setVisibleClients([])
		} else {
			setVisibleClients(clientEntries.map(c => c.id))
		}
	}

	if (!tasks.length && !loading) {
		return (
			<div className="flex items-center justify-center h-64 purcarte-blur theme-card-style">
				<p className="text-secondary-foreground">暂无延迟任务，请先在后台创建</p>
			</div>
		)
	}

	return (
		<div className="space-y-4">
			<div className="purcarte-blur theme-card-style p-4 space-y-3">
				<div className="flex items-center justify-between gap-2 text-sm text-secondary-foreground flex-wrap">
					<div className="flex items-center gap-2">
						<ClipboardList className="size-4 text-primary" />
						<span>任务（{filteredTasks.length}/{tasks.length}）</span>
					</div>
					<div className="relative">
						<Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-secondary-foreground" />
						<input
							type="text"
							placeholder="搜索任务..."
							value={taskSearch}
							onChange={e => setTaskSearch(e.target.value)}
							className="w-40 h-7 pl-7 pr-2 text-sm bg-transparent border-b border-(--accent-6) focus:border-(--accent-9) outline-none transition-colors placeholder:text-(--gray-9)"
						/>
					</div>
				</div>
				<div className="max-h-[300px] overflow-y-auto nice-scrollbar pr-1">
					{filteredTasks.length === 0 ? (
						<span className="text-sm text-secondary-foreground">未找到匹配的任务</span>
					) : (
						<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
							{filteredTasks.map(task => (
								<Button
									key={task.id}
									variant={task.id === selectedTaskId ? 'secondary' : 'ghost'}
									size="sm"
									onClick={() => onSelectTask(task.id)}
									className="justify-start"
								>
									{task.name}
								</Button>
							))}
						</div>
					)}
				</div>
				<div className={`flex flex-wrap gap-3 ${isMobile ? 'flex-col' : 'items-center justify-between'}`}>
					<div className="flex gap-2 flex-wrap">
						{timeRanges.map(range => (
							<Button
								key={range.label}
								variant={hours === range.hours ? 'secondary' : 'ghost'}
								size="sm"
								onClick={() => onChangeHours(range.hours)}>
								{range.label}
							</Button>
						))}
					</div>
					{selectedTask && (
						<div className="flex flex-wrap gap-2 items-center text-sm text-secondary-foreground">
							<span className="inline-flex items-center h-8 px-3 rounded-full bg-(--accent-a3) text-primary font-medium">
								{selectedTask.type?.toUpperCase() || 'PING'}
							</span>
							<span className="inline-flex items-center h-8 px-3 rounded-full bg-(--accent-a2)">间隔：{selectedTask.interval}s</span>
							<span className="inline-flex items-center h-8 px-3 rounded-full bg-(--accent-a2)">
								节点数：{selectedTask.clients?.length || clientEntries.length}
							</span>
						</div>
					)}
				</div>
			</div>

			<div className="relative space-y-4">
				{(historyLoading || loading) && (
					<div className="absolute inset-0 flex items-center justify-center purcarte-blur rounded-lg z-10">
						<Loading text="正在加载图表数据..." />
					</div>
				)}
				{error && (
					<div className="absolute inset-0 flex items-center justify-center purcarte-blur rounded-lg z-10">
						<p className="text-red-500">{error}</p>
					</div>
				)}

				<div className="purcarte-blur theme-card-style p-3 relative">
					<div className="absolute top-2 right-2">
						<Tips>
							<span
								dangerouslySetInnerHTML={{
									__html: '<p>丢包率按可见时间范围计算，仅供参考</p>'
								}}
							/>
						</Tips>
					</div>
					<div className="flex items-center justify-between gap-3 flex-wrap mb-3 text-sm text-secondary-foreground">
						<div className="flex items-center gap-2 flex-wrap">
							<div className="flex items-center gap-1 mr-2 border-r border-(--accent-4) pr-3">
								<Button variant={groupMode === 'none' ? 'secondary' : 'ghost'} size="sm" onClick={() => setGroupMode('none')} title="不分组">
									<List className="size-4" />
								</Button>
								<Button variant={groupMode === 'region' ? 'secondary' : 'ghost'} size="sm" onClick={() => setGroupMode('region')} title="按地域分组">
									<Globe className="size-4" />
								</Button>
								<Button variant={groupMode === 'group' ? 'secondary' : 'ghost'} size="sm" onClick={() => setGroupMode('group')} title="按分组">
									<Layers className="size-4" />
								</Button>
							</div>
							<Button variant={sortKey === 'default' ? 'secondary' : 'ghost'} size="sm" onClick={() => setSortKey('default')}>
								默认
							</Button>
							<Button variant={sortKey === 'name' ? 'secondary' : 'ghost'} size="sm" onClick={() => setSortKey('name')}>
								按名称
							</Button>
							<Button variant={sortKey === 'latency' ? 'secondary' : 'ghost'} size="sm" onClick={() => setSortKey('latency')}>
								按延迟
							</Button>
							<Button variant={sortKey === 'loss' ? 'secondary' : 'ghost'} size="sm" onClick={() => setSortKey('loss')}>
								按丢包
							</Button>
							<div className="flex items-center gap-1 ml-2">
								<Button variant={lossFilter === 'loss' ? 'secondary' : 'ghost'} size="sm" onClick={() => setLossFilter(prev => (prev === 'loss' ? 'all' : 'loss'))}>
									只看有丢包
								</Button>
								<Button
									variant={lossFilter === 'no_loss' ? 'secondary' : 'ghost'}
									size="sm"
									onClick={() => setLossFilter(prev => (prev === 'no_loss' ? 'all' : 'no_loss'))}
								>
									只看无丢包
								</Button>
							</div>
						</div>
						<div className="flex items-center gap-3 mr-3">
							<div className="relative">
								<Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-secondary-foreground" />
								<input
									type="text"
									placeholder="搜索节点..."
									value={nodeSearch}
									onChange={e => setNodeSearch(e.target.value)}
									className="w-40 h-7 pl-7 pr-2 text-sm bg-transparent border-b border-(--accent-6) focus:border-(--accent-9) outline-none transition-colors placeholder:text-(--gray-9)"
								/>
							</div>
							<span className="text-xs text-secondary-foreground">
								显示 {filteredClientStats.items.length} / {clientStats.total}
							</span>
						</div>
					</div>
					<div className="max-h-[300px] overflow-y-auto nice-scrollbar pr-1">
						{groupedClients.length === 0 || (groupedClients.length === 1 && groupedClients[0].items.length === 0) ? (
							<div className="text-center py-4">
								<span className="text-sm text-secondary-foreground px-3 py-2 rounded-lg bg-(--accent-a2)">暂无匹配数据</span>
							</div>
						) : (
							<div className="space-y-3">
								{groupedClients.map(group => {
									const isCollapsed = collapsedGroups.has(group.key)
									const showGroupHeader = groupMode !== 'none' && group.label

									return (
										<div key={group.key}>
											{showGroupHeader && (
												<div
													className="flex items-center gap-2 mb-2 cursor-pointer select-none hover:bg-(--accent-a2) rounded-lg px-2 py-1.5 transition-colors"
													onClick={() => toggleGroupCollapse(group.key)}
												>
													{isCollapsed ? (
														<ChevronRight className="size-4 text-secondary-foreground" />
													) : (
														<ChevronDown className="size-4 text-secondary-foreground" />
													)}
													{groupMode === 'region' && <Flag flag={group.key} size="4" />}
													<span className="text-sm font-medium text-secondary-foreground">{group.label}</span>
													<span className="text-xs text-(--accent-9) bg-(--accent-a3) px-1.5 py-0.5 rounded-full">{group.items.length}</span>
												</div>
											)}
											{!isCollapsed && (
												<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
													{group.items.map(client => {
														const isVisible = visibleClients.includes(client.id)
														const lossText = `${client.loss.toFixed(1)}%`
														const entry = clientEntries.find(c => c.id === client.id)
														return (
															<div
																key={client.id}
																className={`group flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-all ${
																	isVisible ? 'bg-(--accent-a3)' : 'bg-(--accent-a2) opacity-60'
																} hover:bg-(--accent-a4)`}
																onClick={() =>
																	setVisibleClients(prev =>
																		prev.includes(client.id) ? prev.filter(id => id !== client.id) : [...prev, client.id]
																	)
																}
															>
																<div className="flex items-center gap-2 min-w-0 flex-1">
																	<span
																		className="w-1 h-5 rounded-full shrink-0 transition-opacity"
																		style={{ backgroundColor: client.color, opacity: isVisible ? 1 : 0.4 }}
																	></span>
																	{entry?.region && (
																		<Flag flag={entry.region} size="4" />
																	)}
																	<div className="text-sm font-medium truncate">{client.name}</div>
																</div>
																<div className="flex items-center gap-1.5 text-xs font-medium shrink-0">
																	<span className={`inline-flex items-center px-1.5 py-0.5 rounded ${
																		client.value !== null && client.value !== undefined
																			? 'bg-(--accent-a4) text-(--accent-11)'
																			: 'bg-(--gray-a3) text-(--gray-11)'
																	}`}>
																		{client.value !== null && client.value !== undefined ? `${client.value.toFixed(1)}ms` : 'N/A'}
																	</span>
																	<span
																		className={`inline-flex items-center px-1.5 py-0.5 rounded ${
																			client.loss > 0 ? 'bg-red-500/15 text-red-400' : 'bg-(--accent-a2) text-secondary-foreground'
																		}`}>
																		{lossText}
																	</span>
																</div>
															</div>
														)
													})}
												</div>
											)}
										</div>
									)
								})}
							</div>
						)}
					</div>
				</div>

				<Card>
					<CardHeader>
						<div className="flex justify-between items-center flex-wrap gap-2">
							<div className="flex gap-4 flex-wrap">
								<div className="flex items-center space-x-2">
									<Switch id="task-peak-shaving" checked={cutPeak} onCheckedChange={setCutPeak} />
									<Label htmlFor="task-peak-shaving">平滑</Label>
									<Tips>
										<span
											dangerouslySetInnerHTML={{
												__html: '<p>对同一时间轴的多服务器曲线做EWMA平滑，便于观察趋势。</p>'
											}}
										/>
									</Tips>
								</div>
								<div className="flex items-center space-x-2">
									<Switch id="task-connect-breaks" checked={connectBreaks} onCheckedChange={setConnectBreaks} />
									<Label htmlFor="task-connect-breaks">连接断点</Label>
									<Tips>
										<span
											dangerouslySetInnerHTML={{
												__html: '<p>跨过丢包点绘制平滑曲线，并以参考线标记断点位置。</p>'
											}}
										/>
									</Tips>
								</div>
							</div>
							<div className={`flex gap-2 ${isMobile ? 'w-full mt-2' : ''}`}>
								<Button variant="secondary" onClick={handleToggleAll} size="sm">
									{visibleClients.length === clientEntries.length ? (
										<>
											<EyeOff size={16} />
											隐藏全部
										</>
									) : (
										<>
											<Eye size={16} />
											显示全部
										</>
									)}
								</Button>
								<Button
									variant="secondary"
									onClick={() => {
										if (timeRange) {
											if (chartData.length > 1) {
												const endIndex = chartData.length - 1
												const startIndex = 0
												setTimeRange([chartData[startIndex].time, chartData[endIndex].time])
												setBrushIndices({ startIndex, endIndex })
												setIsResetting(true)
											}
										} else if (chartData.length > 1) {
											const endIndex = chartData.length - 1
											const startIndex = Math.floor(endIndex * 0.75)
											setTimeRange([chartData[startIndex].time, chartData[endIndex].time])
											setBrushIndices({ startIndex, endIndex })
										}
									}}
									size="sm">
									{timeRange ? <RefreshCw size={16} /> : <ArrowRightToLine size={16} />}
									{timeRange ? '重置范围' : '四分之一'}
								</Button>
							</div>
						</div>
					</CardHeader>
					<CardContent className="pt-0">
						{chartData.length > 0 ? (
							<ResponsiveContainer width="100%" height={400}>
								<LineChart data={chartData} margin={chartMargin}>
									<CartesianGrid strokeDasharray="2 4" stroke="var(--theme-line-muted-color)" vertical={false} />
									<XAxis
										type="number"
										dataKey="time"
										domain={timeRange || ['dataMin', 'dataMax']}
										tickFormatter={value => lableFormatter(value, hours)}
										tick={{ fill: 'var(--theme-text-muted-color)' }}
										axisLine={{ stroke: 'var(--theme-line-muted-color)' }}
										scale="time"
									/>
									<YAxis
										mirror={true}
										width={40}
										tick={{ fill: 'var(--theme-text-muted-color)' }}
										axisLine={{ stroke: 'var(--theme-line-muted-color)' }}
									/>
									<Tooltip cursor={false} content={<ChartTooltip labelFormatter={value => lableFormatter(value, hours)} />} />
									{connectBreaks &&
										breakPoints.map((point, index) => (
											<ReferenceLine key={`break-${index}`} x={point.x} stroke={point.color} strokeWidth={1.5} strokeOpacity={0.5} />
										))}
									{clientEntries.map(client => (
										<Line
											key={client.id}
											type="monotone"
											dataKey={client.id}
											name={client.name}
											stroke={colorMap[client.id]}
											strokeWidth={2}
											hide={!visibleClients.includes(client.id)}
											dot={false}
											connectNulls={connectBreaks}
										/>
									))}
									<Brush
										{...brushIndices}
										dataKey="time"
										height={30}
										stroke="var(--theme-text-muted-color)"
										fill="var(--accent-a4)"
										tickFormatter={value => lableFormatter(value, hours)}
										onChange={(e: any) => {
											if (e.startIndex !== undefined && e.endIndex !== undefined && chartData[e.startIndex] && chartData[e.endIndex]) {
												setTimeRange([chartData[e.startIndex].time, chartData[e.endIndex].time])
												setBrushIndices({ startIndex: e.startIndex, endIndex: e.endIndex })
											} else {
												setTimeRange(null)
												setBrushIndices({})
											}
										}}
									/>
								</LineChart>
							</ResponsiveContainer>
						) : (
							<div className="h-[400px] flex items-center justify-center">
								<p>暂无数据</p>
							</div>
						)}
					</CardContent>
				</Card>
			</div>
		</div>
	)
}

const ServerModeSection = ({
	nodes,
	selectedNode,
	onSelectNode,
	hours,
	onChangeHours,
	timeRanges
}: {
	nodes: NodeData[]
	selectedNode: NodeData | null
	onSelectNode: (uuid: string) => void
	hours: number
	onChangeHours: (hours: number) => void
	timeRanges: TimeRangeOption[]
}) => {
	const { enablePingChart } = useAppConfig()
	const [groupMode, setGroupMode] = useState<GroupMode>('none')
	const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
	const [searchQuery, setSearchQuery] = useState('')

	// 筛选节点
	const filteredNodes = useMemo(() => {
		if (!searchQuery.trim()) return nodes
		const search = searchQuery.toLowerCase()
		return nodes.filter(node => node.name.toLowerCase().includes(search))
	}, [nodes, searchQuery])

	// 分组数据
	const groupedNodes = useMemo(() => {
		if (groupMode === 'none') {
			// 未分组时按 weight 排序
			const sortedItems = [...filteredNodes].sort((a, b) => (a.weight ?? 0) - (b.weight ?? 0))
			return [{ key: 'all', label: '', items: sortedItems }]
		}

		const groups: Record<string, NodeData[]> = {}

		for (const node of filteredNodes) {
			let groupKey: string

			if (groupMode === 'region') {
				groupKey = node.region || 'unknown'
			} else {
				groupKey = node.group || 'default'
			}

			if (!groups[groupKey]) {
				groups[groupKey] = []
			}
			groups[groupKey].push(node)
		}

		// 分组排序：地域模式按优先级排序，分组模式按 weight 排序
		const sortedEntries = Object.entries(groups).sort((a, b) => {
			if (groupMode === 'region') {
				return sortByRegionPriority(a[0], b[0])
			} else {
				// 按分组内第一个节点的 weight 排序
				const weightA = a[1][0]?.weight ?? 0
				const weightB = b[1][0]?.weight ?? 0
				return weightA - weightB
			}
		})

		return sortedEntries.map(([key, items]) => {
			// 分组内部按 weight 排序
			const sortedItems = [...items].sort((a, b) => (a.weight ?? 0) - (b.weight ?? 0))
			return {
				key,
				label: groupMode === 'region' ? getRegionDisplayName(key) : (key || '默认分组'),
				items: sortedItems
			}
		})
	}, [filteredNodes, groupMode])

	const toggleGroupCollapse = (groupKey: string) => {
		setCollapsedGroups(prev => {
			const next = new Set(prev)
			if (next.has(groupKey)) {
				next.delete(groupKey)
			} else {
				next.add(groupKey)
			}
			return next
		})
	}

	return (
		<div className="space-y-4">
			<div className="purcarte-blur theme-card-style p-4 space-y-3">
				<div className="flex items-center justify-between gap-2 text-sm text-secondary-foreground flex-wrap">
					<div className="flex items-center gap-2">
						<Server className="size-4 text-primary" />
						<span>选择服务器（{filteredNodes.length}/{nodes.length}）</span>
					</div>
					<div className="flex items-center gap-3">
						<div className="relative">
							<Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-secondary-foreground" />
							<input
								type="text"
								placeholder="搜索服务器..."
								value={searchQuery}
								onChange={e => setSearchQuery(e.target.value)}
								className="w-40 h-7 pl-7 pr-2 text-sm bg-transparent border-b border-(--accent-6) focus:border-(--accent-9) outline-none transition-colors placeholder:text-(--gray-9)"
							/>
						</div>
						<div className="flex items-center gap-1">
							<Button variant={groupMode === 'none' ? 'secondary' : 'ghost'} size="sm" onClick={() => setGroupMode('none')} title="默认">
								<List className="size-4" />
							</Button>
							<Button variant={groupMode === 'region' ? 'secondary' : 'ghost'} size="sm" onClick={() => setGroupMode('region')} title="按地域分组">
								<Globe className="size-4" />
							</Button>
							<Button variant={groupMode === 'group' ? 'secondary' : 'ghost'} size="sm" onClick={() => setGroupMode('group')} title="按分组">
								<Layers className="size-4" />
							</Button>
						</div>
					</div>
				</div>
				<div className="max-h-[300px] overflow-y-auto nice-scrollbar pr-1">
					{filteredNodes.length === 0 ? (
						<span className="text-secondary-foreground text-sm">暂无匹配的节点</span>
					) : (
						<div className="space-y-3">
							{groupedNodes.map(group => {
								const isCollapsed = collapsedGroups.has(group.key)
								const showGroupHeader = groupMode !== 'none' && group.label

								return (
									<div key={group.key}>
										{showGroupHeader && (
											<div
												className="flex items-center gap-2 mb-2 cursor-pointer select-none hover:bg-(--accent-a2) rounded-lg px-2 py-1.5 transition-colors"
												onClick={() => toggleGroupCollapse(group.key)}
											>
												{isCollapsed ? (
													<ChevronRight className="size-4 text-secondary-foreground" />
												) : (
													<ChevronDown className="size-4 text-secondary-foreground" />
												)}
												{groupMode === 'region' && <Flag flag={group.key} size="4" />}
												<span className="text-sm font-medium text-secondary-foreground">{group.label}</span>
												<span className="text-xs text-(--accent-9) bg-(--accent-a3) px-1.5 py-0.5 rounded-full">{group.items.length}</span>
											</div>
										)}
										{!isCollapsed && (
											<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
												{group.items.map(node => {
													const isSelected = selectedNode?.uuid === node.uuid
													return (
														<div
															key={node.uuid}
															onClick={() => onSelectNode(node.uuid)}
															className={`group flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-all ${
																isSelected
																	? 'bg-(--accent-a4) shadow-sm'
																	: 'bg-(--accent-a2) hover:bg-(--accent-a3) opacity-80 hover:opacity-100'
															}`}
														>
															{node.region && (
																<Flag flag={node.region} size="4" />
															)}
															<div className="text-sm font-medium truncate flex-1">{node.name}</div>
															{isSelected && (
																<div className="w-1.5 h-1.5 rounded-full bg-(--accent-9) shrink-0"></div>
															)}
														</div>
													)
												})}
											</div>
										)}
									</div>
								)
							})}
						</div>
					)}
				</div>
				<div className="flex gap-2 flex-wrap pt-2">
					{timeRanges.map(range => (
						<Button key={range.label} variant={hours === range.hours ? 'secondary' : 'ghost'} size="sm" onClick={() => onChangeHours(range.hours)}>
							{range.label}
						</Button>
					))}
				</div>
			</div>

			{!enablePingChart && (
				<div className="purcarte-blur theme-card-style p-4 text-sm text-secondary-foreground">
					<p>已禁用延迟图表，请在主题配置中开启 enablePingChart。</p>
				</div>
			)}

			{enablePingChart && (
				<div className="space-y-2">
					{selectedNode && <PingChart node={selectedNode} hours={hours} />}
					{!selectedNode && <div className="purcarte-blur theme-card-style p-4 text-secondary-foreground text-sm">请选择服务器查看延迟详情</div>}
				</div>
			)}
		</div>
	)
}

export default LatencyMonitor
