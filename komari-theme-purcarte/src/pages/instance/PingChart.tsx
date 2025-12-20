import { memo, useState, useMemo, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { useIsMobile } from '@/hooks/useMobile'
import { Eye, EyeOff, ArrowRightToLine, RefreshCw, Search } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Brush, ReferenceLine } from 'recharts'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Label } from '@radix-ui/react-label'
import type { NodeData } from '@/types/node'
import Loading from '@/components/loading'
import { usePingChart } from '@/hooks/usePingChart'
import fillMissingTimePoints, { cutPeakValues, calculateTaskStats } from '@/utils/RecordHelper'
import { useConfigItem } from '@/config'
import { CustomTooltip } from '@/components/ui/tooltip'
import Tips from '@/components/ui/tips'
import { generateColor, lableFormatter } from '@/utils/chartHelper'

interface PingChartProps {
	node: NodeData
	hours: number
}

const PingChart = memo(({ node, hours }: PingChartProps) => {
	const { loading, error, pingHistory } = usePingChart(node, hours)
	const [visiblePingTasks, setVisiblePingTasks] = useState<number[]>([])
	const [timeRange, setTimeRange] = useState<[number, number] | null>(null)
	const [brushIndices, setBrushIndices] = useState<{
		startIndex?: number
		endIndex?: number
	}>({})
	const [cutPeak, setCutPeak] = useState(false)
	const [connectBreaks, setConnectBreaks] = useState(useConfigItem('enableConnectBreaks'))
	const [isResetting, setIsResetting] = useState(false)
	const [sortKey, setSortKey] = useState<'default' | 'name' | 'latency' | 'loss'>('default')
	const [lossFilter, setLossFilter] = useState<'all' | 'loss' | 'no_loss'>('all')
	const [taskSearch, setTaskSearch] = useState('')
	const maxPointsToRender = useConfigItem('pingChartMaxPoints') || 0 // 0表示不限制
	const isMobile = useIsMobile()
	const prevNodeRef = useRef<string | undefined>(undefined)
	const pendingNodeChangeRef = useRef<boolean>(false)

	// 当节点变化时，标记需要全选
	useEffect(() => {
		if (node?.uuid !== prevNodeRef.current) {
			pendingNodeChangeRef.current = true
			prevNodeRef.current = node?.uuid
		}
	}, [node?.uuid])

	// 当任务数据加载完成后，处理任务选择
	useEffect(() => {
		if (pingHistory?.tasks) {
			const taskIds = pingHistory.tasks.map(t => t.id)
			// 如果有待处理的节点切换，全选所有任务
			if (pendingNodeChangeRef.current) {
				setVisiblePingTasks(taskIds)
				pendingNodeChangeRef.current = false
				return
			}
			// 否则保持现有选择，补齐新增的任务
			setVisiblePingTasks(prevVisibleTasks => {
				if (prevVisibleTasks.length === 0) {
					return taskIds
				}
				const newVisibleTasks = taskIds.filter(id => prevVisibleTasks.includes(id))
				return newVisibleTasks.length > 0 ? newVisibleTasks : taskIds
			})
		}
	}, [pingHistory?.tasks])

	useEffect(() => {
		if (isResetting) {
			setTimeRange(null)
			setBrushIndices({})
			setIsResetting(false)
		}
	}, [isResetting])

	const chartMargin = { top: 8, right: 16, bottom: 8, left: 16 }

	const handleTaskVisibilityToggle = (taskId: number) => {
		setVisiblePingTasks(prev => (prev.includes(taskId) ? prev.filter(id => id !== taskId) : [...prev, taskId]))
	}

	const handleToggleAll = () => {
		if (!pingHistory?.tasks) return
		if (visiblePingTasks.length === pingHistory.tasks.length) {
			setVisiblePingTasks([])
		} else {
			setVisiblePingTasks(pingHistory.tasks.map(t => t.id))
		}
	}

	const baseTasks = useMemo(() => {
		if (!pingHistory?.tasks) return []
		return [...pingHistory.tasks]
	}, [pingHistory?.tasks])

	const taskStats = useMemo(() => {
		if (!pingHistory?.records || !baseTasks.length) return { items: [], total: 0 }
		const baseIndex = new Map(baseTasks.map((t, idx) => [t.id, idx]))

		const stats = baseTasks.map(task => {
			const { loss, latestValue, latestTime } = calculateTaskStats(pingHistory.records, task.id, timeRange)
			return {
				...task,
				value: latestValue,
				time: latestTime,
				loss: loss,
				color: generateColor(task.name, baseTasks)
			}
		})

		const filteredBySearch = taskSearch.trim()
			? stats.filter(t => t.name.toLowerCase().includes(taskSearch.trim().toLowerCase()))
			: stats

		const filteredByLoss =
			lossFilter === 'loss'
				? filteredBySearch.filter(t => t.loss > 0)
				: lossFilter === 'no_loss'
					? filteredBySearch.filter(t => t.loss === 0)
					: filteredBySearch

		const bySortKey = (a: (typeof stats)[number], b: (typeof stats)[number]) => {
			if (sortKey === 'default') {
				return (baseIndex.get(a.id) ?? 0) - (baseIndex.get(b.id) ?? 0)
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
	}, [pingHistory?.records, baseTasks, timeRange, lossFilter, sortKey, taskSearch])

	const allowedTaskIds = useMemo(() => {
		if (lossFilter === 'all' && !taskSearch.trim()) return baseTasks.map(t => t.id)
		return taskStats.items.map(t => t.id)
	}, [lossFilter, taskSearch, taskStats.items, baseTasks])

	useEffect(() => {
		setVisiblePingTasks(allowedTaskIds)
	}, [allowedTaskIds])

	const chartData = useMemo(() => {
		if (!pingHistory || !pingHistory.records || !pingHistory.tasks) return []

		const grouped: Record<string, any> = {}
		const timeKeys: number[] = []

		for (const rec of pingHistory.records) {
			const t = new Date(rec.time).getTime()
			let foundKey = null
			for (const key of timeKeys) {
				if (Math.abs(key - t) <= 5000) {
					foundKey = key
					break
				}
			}
			const useKey = foundKey !== null ? foundKey : t
			if (!grouped[useKey]) {
				grouped[useKey] = { time: useKey }
				if (foundKey === null) {
					timeKeys.push(useKey)
				}
			}
			grouped[useKey][rec.task_id] = rec.value === -1 ? null : rec.value
		}

		let full = Object.values(grouped).sort((a: any, b: any) => a.time - b.time)

		if (hours !== 0) {
			const task = pingHistory.tasks
			let interval = task[0]?.interval || 60
			const maxGap = interval * 1.2
			const selectedDurationHours = hours
			const totalDurationSeconds = hours * 60 * 60

			if (selectedDurationHours > 30 * 24) {
				interval = 60 * 60
			} else if (selectedDurationHours > 7 * 24) {
				interval = 15 * 60
			} else if (selectedDurationHours > 24) {
				interval = 5 * 60
			}

			full = fillMissingTimePoints(full, interval, totalDurationSeconds, maxGap)

			full = full.map((d: any) => ({
				...d,
				time: new Date(d.time).getTime()
			}))
		}

		if (full.length > maxPointsToRender && maxPointsToRender > 0) {
			const samplingFactor = Math.ceil(full.length / maxPointsToRender)
			const sampledData = []
			for (let i = 0; i < full.length; i += samplingFactor) {
				sampledData.push(full[i])
			}
			full = sampledData
		}

		if (cutPeak && pingHistory.tasks.length > 0) {
			const taskKeys = pingHistory.tasks.map(task => String(task.id))
			full = cutPeakValues(full, taskKeys)
		}

		const allowedSet = new Set(allowedTaskIds.map(id => String(id)))
		full = full.map((d: any) => {
			const next: any = { time: d.time }
			for (const key of Object.keys(d)) {
				if (key === 'time') continue
				if (allowedSet.has(key)) {
					next[key] = d[key]
				}
			}
			return next
		})

		return full
	}, [pingHistory, hours, maxPointsToRender, cutPeak, allowedTaskIds])

		const breakPoints = useMemo(() => {
			if (!connectBreaks || !chartData || chartData.length < 2) {
				return []
			}
			const points: { x: number; color: string }[] = []
			const visitList = lossFilter === 'all' && !taskSearch.trim() ? baseTasks : taskStats.items
			for (const task of visitList) {
				if (!visiblePingTasks.includes(task.id)) {
					continue
				}
				const taskKey = String(task.id)
			for (let i = 1; i < chartData.length; i++) {
				const prevPoint = chartData[i - 1]
				const currentPoint = chartData[i]

				const isBreak =
					(currentPoint[taskKey] === null || currentPoint[taskKey] === undefined) && prevPoint[taskKey] !== null && prevPoint[taskKey] !== undefined

					if (isBreak) {
						points.push({
							x: currentPoint.time,
							color: generateColor(task.name, baseTasks)
						})
					}
				}
			}
			return points
	}, [chartData, baseTasks, visiblePingTasks, connectBreaks, lossFilter, taskSearch, taskStats.items])

	return (
		<div className="relative space-y-4">
			{loading && (
				<div className="absolute inset-0 flex items-center justify-center purcarte-blur rounded-lg z-10">
					<Loading text="正在加载图表数据..." />
				</div>
			)}
			{error && (
				<div className="absolute inset-0 flex items-center justify-center purcarte-blur rounded-lg z-10">
					<p className="text-red-500">{error}</p>
				</div>
			)}

			{pingHistory?.tasks && pingHistory.tasks.length > 0 && (
				<div className="purcarte-blur theme-card-style p-3 relative">
					<div className="absolute top-2 right-2">
						<Tips>
							<span
								dangerouslySetInnerHTML={{
									__html: '<p>丢包率计算算法并不准确，谨慎参考</p>'
								}}></span>
						</Tips>
					</div>
					<div className="flex items-center justify-between gap-3 flex-wrap mb-3 text-sm text-secondary-foreground">
						<div className="flex items-center gap-2 flex-wrap">
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
						<div className="flex items-center gap-3 mr-5">
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
							<span className="text-xs text-secondary-foreground">
								显示 {taskStats.items.length} / {taskStats.total}
							</span>
						</div>
					</div>
					<div className="max-h-[400px] overflow-y-auto nice-scrollbar pr-1">
						<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
							{taskStats.items.length === 0 ? (
								<div className="col-span-full text-center py-4">
									<span className="text-sm text-secondary-foreground px-3 py-2 rounded-lg bg-(--accent-a2)">暂无匹配数据</span>
								</div>
							) : (
								taskStats.items.map(task => {
									const isVisible = visiblePingTasks.includes(task.id)
									const lossText = `${task.loss.toFixed(1)}%`

									return (
										<div
											key={task.id}
											className={`group flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-all ${
												isVisible ? 'bg-(--accent-a3)' : 'bg-(--accent-a2) opacity-60'
											} hover:bg-(--accent-a4)`}
											onClick={() => handleTaskVisibilityToggle(task.id)}>
											<div className="flex items-center gap-2 min-w-0 flex-1">
												<span
													className="w-1 h-5 rounded-full shrink-0 transition-opacity"
													style={{ backgroundColor: task.color, opacity: isVisible ? 1 : 0.4 }}></span>
												<div className="text-sm font-medium truncate">{task.name}</div>
											</div>
											<div className="flex items-center gap-1.5 text-xs font-medium shrink-0">
												<span
													className={`inline-flex items-center px-1.5 py-0.5 rounded ${
														task.value !== null ? 'bg-(--accent-a4) text-(--accent-11)' : 'bg-(--gray-a3) text-(--gray-11)'
													}`}>
													{task.value !== null ? `${task.value.toFixed(1)}ms` : 'N/A'}
												</span>
												<span
													className={`inline-flex items-center px-1.5 py-0.5 rounded ${
														task.loss > 0 ? 'bg-red-500/15 text-red-400' : 'bg-(--accent-a2) text-secondary-foreground'
													}`}>
													{lossText}
												</span>
											</div>
										</div>
									)
								})
							)}
						</div>
					</div>
				</div>
			)}

			<Card>
				<CardHeader>
					<div className="flex justify-between items-center flex-wrap">
						<div className="flex gap-4 flex-wrap">
							<div className="flex items-center space-x-2">
								<Switch id="peak-shaving" checked={cutPeak} onCheckedChange={setCutPeak} />
								<Label htmlFor="peak-shaving">平滑</Label>
								<Tips>
									<span
										dangerouslySetInnerHTML={{
											__html: '<h2 class="text-lg font-bold">关于数据平滑的提示</h2><p>当您开启平滑后，您在统计图中看到的曲线经过<strong>指数加权移动平均 (EWMA)</strong> 算法处理，这是一种常用的数据平滑技术。</p></br><p>需要注意的是，经过EWMA算法平滑后的曲线所展示的数值，<strong>并非原始的、真实的测量数据</strong>。它们是根据EWMA算法计算得出的一个<strong>平滑趋势线</strong>，旨在减少数据波动，使数据模式和趋势更容易被识别。</p></br><p>因此，您看到的数值更像是<strong>视觉上的呈现</strong>，帮助您更好地理解数据的整体走向和长期趋势，而不是每一个时间点的精确真实值。如果您需要查看具体、原始的数据点，请参考未经平滑处理的数据视图。</p>'
										}}
									/>
								</Tips>
							</div>
							<div className="flex items-center space-x-2">
								<Switch id="connect-breaks" checked={connectBreaks} onCheckedChange={setConnectBreaks} />
								<Label htmlFor="connect-breaks">连接断点</Label>
								<Tips>
									<span
										dangerouslySetInnerHTML={{
											__html: '<h2 class="text-lg font-bold">关于连接断点的提示</h2><p><strong>默认关闭，可在后台配置</strong></p><p>当您开启"连接断点"功能后，图表中的曲线将会跨过那些由于网络问题或其他原因导致的丢包点，形成一条连续的线条。同时，系统会在丢包位置显示<strong>半透明的垂直参考线</strong>来标记断点位置。</p>'
										}}
									/>
								</Tips>
							</div>
						</div>
						<div className={`flex gap-2 ${isMobile ? 'w-full mt-2' : ''}`}>
							<Button variant="secondary" onClick={handleToggleAll} size="sm">
								{pingHistory?.tasks && visiblePingTasks.length === pingHistory.tasks.length ? (
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
					{pingHistory?.tasks && pingHistory.tasks.length > 0 ? (
						<ResponsiveContainer width="100%" height={400}>
							<LineChart data={chartData} margin={chartMargin}>
								<CartesianGrid strokeDasharray="2 4" stroke="var(--theme-line-muted-color)" vertical={false} />
								<XAxis
									type="number"
									dataKey="time"
									domain={timeRange || ['dataMin', 'dataMax']}
									tickFormatter={time => {
										const date = new Date(time)
										if (hours === 0) {
											return date.toLocaleTimeString([], {
												hour: '2-digit',
												minute: '2-digit',
												second: '2-digit'
											})
										}
										return date.toLocaleString([], {
											month: '2-digit',
											day: '2-digit',
											hour: '2-digit',
											minute: '2-digit'
										})
									}}
									tick={{ fill: 'var(--theme-text-muted-color)' }}
									axisLine={{
										stroke: 'var(--theme-line-muted-color)'
									}}
									scale="time"
								/>
								<YAxis
									mirror={true}
									width={30}
									tick={{ fill: 'var(--theme-text-muted-color)' }}
									axisLine={{
										stroke: 'var(--theme-line-muted-color)'
									}}
								/>
								<Tooltip cursor={false} content={<CustomTooltip labelFormatter={value => lableFormatter(value, hours)} />} />
								{connectBreaks &&
									breakPoints.map((point, index) => (
										<ReferenceLine key={`break-${index}`} x={point.x} stroke={point.color} strokeWidth={1.5} strokeOpacity={0.5} />
									))}
								{(lossFilter === 'all' && !taskSearch.trim() ? baseTasks : taskStats.items).map((task: any) => (
									<Line
										key={task.id}
										type={'monotone'}
										dataKey={String(task.id)}
										name={task.name}
										stroke={generateColor(task.name, baseTasks)}
										strokeWidth={2}
										hide={!visiblePingTasks.includes(task.id)}
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
									tickFormatter={time => {
										const date = new Date(time)
										if (hours === 0) {
											return date.toLocaleTimeString([], {
												hour: '2-digit',
												minute: '2-digit',
												second: '2-digit'
											})
										}
										return date.toLocaleDateString([], {
											month: '2-digit',
											day: '2-digit',
											hour: '2-digit',
											minute: '2-digit'
										})
									}}
									onChange={(e: any) => {
										if (e.startIndex !== undefined && e.endIndex !== undefined && chartData[e.startIndex] && chartData[e.endIndex]) {
											setTimeRange([chartData[e.startIndex].time, chartData[e.endIndex].time])
											setBrushIndices({
												startIndex: e.startIndex,
												endIndex: e.endIndex
											})
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
	)
})

export default PingChart
