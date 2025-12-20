import { useMemo, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import Loading from '@/components/loading'
import Tips from '@/components/ui/tips'
import type { NodeData, SPPingRecord, SPPingTask } from '@/types/node'
import { useSpPingChart } from '@/hooks/useSpPingChart'
import { HelpCircle } from 'lucide-react'
import {
	ComposedChart,
	Area,
	Line,
	XAxis,
	YAxis,
	CartesianGrid,
	Tooltip,
	ResponsiveContainer,
	Customized
} from 'recharts'

const colors = ['#5BBFBA', '#65A572', '#8C7AE6', '#FF8E72', '#EF5DA8', '#FFA447', '#7AD6F0', '#FFBF69']

const lossColorSteps = [
	{ label: '0', max: 0, color: '#2ecc71' },
	{ label: '1', max: 1, color: '#2d9cdb' },
	{ label: '2', max: 2, color: '#9b59b6' },
	{ label: '3', max: 3, color: '#f1c40f' },
	{ label: '4-5', max: 5, color: '#f39c12' },
	{ label: '6-10', max: 10, color: '#e67e22' },
	{ label: '11-19', max: 19, color: '#e74c3c' },
	{ label: '20/20', max: 100, color: '#b71c1c' }
]

type ChartStats = {
	min: number | null
	max: number | null
	p10: number | null
	p90: number | null
	p25: number | null
	p75: number | null
	median: number | null
	lossRate: number
}

type ChartPoint = {
	time: number
	meta: Record<number, ChartStats>
	[key: string]: any
}

const formatTimeLabel = (value: number, hours: number, showSecond = false) => {
	const date = new Date(value)
	if (hours < 24) {
		return date.toLocaleTimeString([], {
			hour: '2-digit',
			minute: '2-digit',
			second: showSecond ? '2-digit' : undefined
		})
	}
	return date.toLocaleString([], {
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit'
	})
}

const safeLatency = (v: number | undefined | null) => (typeof v === 'number' && v >= 0 ? v : null)

const percentile = (values: number[], pct: number) => {
	if (!values.length) return null
	if (pct <= 0) return values[0]
	if (pct >= 1) return values[values.length - 1]
	const pos = (values.length - 1) * pct
	const lo = Math.floor(pos)
	const hi = Math.ceil(pos)
	if (lo === hi) return values[lo]
	const frac = pos - lo
	const v = values[lo] + (values[hi] - values[lo]) * frac
	return Math.round(v * 1000) / 1000
}

const deriveStats = (rec: SPPingRecord): ChartStats => {
	const samples = (rec.samples || []).filter(v => v >= 0).sort((a, b) => a - b)
	const lossRate = rec.total > 0 ? (rec.loss / rec.total) * 100 : 0
	const p25 =
		samples.length > 0
			? percentile(samples, 0.25)
			: rec.p10 >= 0 && rec.median >= 0
				? Math.round((rec.p10 + (rec.median - rec.p10) * 0.5) * 1000) / 1000
				: null
	const p75 =
		samples.length > 0
			? percentile(samples, 0.75)
			: rec.p90 >= 0 && rec.median >= 0
				? Math.round((rec.median + (rec.p90 - rec.median) * 0.5) * 1000) / 1000
				: null

	return {
		min: safeLatency(rec.min) ?? (samples.length ? samples[0] : null),
		max: safeLatency(rec.max) ?? (samples.length ? samples[samples.length - 1] : null),
		p10: safeLatency(rec.p10),
		p90: safeLatency(rec.p90),
		p25: safeLatency(p25),
		p75: safeLatency(p75),
		median: safeLatency(rec.median),
		lossRate: Number(lossRate.toFixed(2))
	}
}

const formatLatency = (v: number | null | undefined, digits = 2) => {
	if (v === null || v === undefined || Number.isNaN(v)) return '—'
	if (v < 1) {
		const us = v * 1000
		return `${us.toFixed(us < 10 ? 2 : 0)} us`
	}
	return `${v.toFixed(digits)} ms`
}

const formatLoss = (v: number | null | undefined) => {
	if (v === null || v === undefined || Number.isNaN(v)) return '—'
	return `${v.toFixed(2)}%`
}

const formatRange = (from: number | null, to: number | null) => {
	if (from === null || to === null) return '—'
	return `${formatLatency(from, 2)} ~ ${formatLatency(to, 2)}`
}

const calcStats = (values: number[]) => {
	if (!values.length) {
		return { avg: null, min: null, max: null, sd: null, now: null }
	}
	const min = Math.min(...values)
	const max = Math.max(...values)
	const now = values[values.length - 1]
	const sum = values.reduce((a, b) => a + b, 0)
	const avg = sum / values.length
	const variance = values.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / values.length
	const sd = Math.sqrt(variance)
	return { avg, min, max, sd, now }
}

const getLossColor = (lossRate: number) => {
	const rate = Math.max(0, Math.min(100, lossRate))
	return lossColorSteps.find(step => rate <= step.max)?.color || lossColorSteps[lossColorSteps.length - 1].color
}

const roundDown = (value: number, step: number) => Math.floor(value / step) * step
const roundUp = (value: number, step: number) => Math.ceil(value / step) * step

const calcNiceLatencyDomain = (min: number, max: number): [number, number] => {
	const low = Math.min(min, max)
	const high = Math.max(min, max)
	const range = Math.max(0, high - low)
	const mid = (low + high) / 2

	// 低延迟场景：如果仍按“对称扩展 + 0 截断”，数据会更容易贴近底部。
	// 这里改为固定从 0 起，通过上界逼近 2*mid（即 low+high）来让曲线更接近垂直居中。
	let rawMin = 0
	let rawMax = 0
	if (low < 10) {
		const headroom = Math.max(range * 0.2, 0.8)
		rawMax = Math.max(high + headroom, (low + high) * 1.1)
		rawMax = Math.max(rawMax, 6)
	} else {
		// 中高延迟：以 mid 为中心扩展，并给一个“最小可读跨度”，避免 y 轴过窄导致“满屏线条”
		// range 过大倍增会导致上界离谱（例如 max 200ms 却拉到 400ms+）。
		// 这里改为：以 range 为主、温和放大，同时给一个随 mid 缓慢增长的最小跨度（并设置上限）。
		const minSpan = Math.max(20, Math.min(mid * 0.2, 200))
		const span = Math.max(range * 1.2, minSpan)
		rawMin = mid - span / 2
		rawMax = mid + span / 2
		if (rawMin < 0) {
			rawMin = 0
		}
	}

	const span = Math.max(0.5, rawMax - rawMin)

	let step = 1
	if (span >= 200) step = 50
	else if (span >= 120) step = 20
	else if (span >= 60) step = 10
	else if (span >= 25) step = 5
	else if (span >= 12) step = 2
	else if (span >= 6) step = 1
	else step = 0.5

	const domainMin = Math.max(0, roundDown(rawMin, step))
	const domainMax = roundUp(rawMax, step)
	return [domainMin, domainMax > domainMin ? domainMax : domainMin + step]
}

const calcLatencyTickDigits = (domain: [number, number]) => {
	const span = Math.max(0, domain[1] - domain[0])
	if (span <= 2) return 2
	if (span <= 10) return 1
	return 0
}

const buildChartData = (records: SPPingRecord[]): ChartPoint[] => {
	if (!records?.length) return []
	const grouped = new Map<number, ChartPoint>()
	for (const rec of records) {
		const ts = new Date(rec.time).getTime()
		if (!grouped.has(ts)) grouped.set(ts, { time: ts, meta: {} })
		const point = grouped.get(ts)!
		const stats = deriveStats(rec)
		point.meta[rec.task_id] = stats
		const key = `${rec.task_id}`
		if (stats.p10 !== null && stats.p90 !== null) {
			point[`${key}_p10`] = stats.p10
			point[`${key}_band`] = stats.p90 - stats.p10
		}
		if (stats.median !== null) {
			point[`${key}_median`] = stats.median
		}
		point[`${key}_loss`] = stats.lossRate
	}
	return Array.from(grouped.values()).sort((a, b) => a.time - b.time)
}

type TaskSummary = {
	id: number
	name: string
	step?: number
	pings?: number
	bucket?: number
	min: number | null
	max: number | null
	avg: number | null
	latest: number | null
	lossRate: number
	loss: number
	total: number
	medianAvg: number | null
	medianMin: number | null
	medianMax: number | null
	medianNow: number | null
	medianSd: number | null
	lossAvg: number | null
	lossMin: number | null
	lossMax: number | null
	lossNow: number | null
}

const buildTaskSummary = (records: SPPingRecord[], tasks: SPPingTask[]): TaskSummary[] => {
	if (!records.length) return []
	const taskMap = new Map(tasks.map(t => [t.id, t]))
	type Acc = {
		min: number | null
		max: number | null
		sumMedian: number
		count: number
		latest: number | null
		latestTs: number
		loss: number
		total: number
		medians: number[]
		lossRates: number[]
	}
	const statsMap = new Map<number, Acc>()

	for (const rec of records) {
		const s = deriveStats(rec)
		const prev =
			statsMap.get(rec.task_id) || {
				min: null,
				max: null,
				sumMedian: 0,
				count: 0,
				latest: null,
				latestTs: 0,
				loss: 0,
				total: 0,
				medians: [],
				lossRates: []
			}
		const latestTs = new Date(rec.time).getTime()
		statsMap.set(rec.task_id, {
			min: s.min !== null && (prev.min === null || s.min < prev.min) ? s.min : prev.min,
			max: s.max !== null && (prev.max === null || s.max > prev.max) ? s.max : prev.max,
			sumMedian: prev.sumMedian + (s.median ?? 0),
			count: prev.count + (s.median !== null ? 1 : 0),
			latest: s.median !== null && latestTs >= prev.latestTs ? s.median : prev.latest,
			latestTs: Math.max(prev.latestTs, latestTs),
			loss: prev.loss + rec.loss,
			total: prev.total + rec.total,
			medians: s.median !== null ? [...prev.medians, s.median] : prev.medians,
			lossRates: [...prev.lossRates, s.lossRate]
		})
	}

	return Array.from(statsMap.entries()).map(([id, s]) => {
		const task = taskMap.get(id)
		const avg = s.count > 0 ? s.sumMedian / s.count : null
		const lossRate = s.total > 0 ? (s.loss / s.total) * 100 : 0
		const medianStats = calcStats(s.medians)
		const lossStats = calcStats(s.lossRates)
		return {
			id,
			name: task?.name || `任务 ${id}`,
			step: task?.step,
			pings: task?.pings,
			bucket: task?.bucket,
			min: s.min,
			max: s.max,
			avg,
			latest: s.latest,
			lossRate: Number(lossRate.toFixed(2)),
			loss: s.loss,
			total: s.total,
			medianAvg: medianStats.avg,
			medianMin: medianStats.min,
			medianMax: medianStats.max,
			medianNow: medianStats.now,
			medianSd: medianStats.sd,
			lossAvg: lossStats.avg,
			lossMin: lossStats.min,
			lossMax: lossStats.max,
			lossNow: lossStats.now
		}
	})
}

const SmokeLayer = (props: any & { data: ChartPoint[]; tasks: SPPingTask[]; showSmoke: boolean }) => {
	const { xAxisMap, yAxisMap, data, tasks, showSmoke, offset } = props
	if (!showSmoke || !data?.length) return null
	const xAxis = Object.values(xAxisMap || {})[0] as any
	const yAxis = Object.values(yAxisMap || {})[0] as any
	const xScale = xAxis?.scale as ((v: number) => number) | undefined
	const yScale = yAxis?.scale as ((v: number) => number) | undefined
	if (!xScale || !yScale) return null
	const xs = data.slice(0, Math.min(4, data.length)).map((d: any) => xScale(d.time))
	const gap =
		xs.length > 1
			? xs.slice(1).reduce((acc: number, cur: number, idx: number) => acc + Math.abs(cur - xs[idx]), 0) / (xs.length - 1)
			: 12
	const width = Math.max(6, Math.min(28, gap * 0.8 || 12))
	const clipId = 'sp-smoke-clip'
	const clipX = offset?.left ?? xAxis?.x ?? 0
	const clipY = offset?.top ?? yAxis?.y ?? 0
	const clipWidth = offset?.width ?? xAxis?.width ?? props?.width ?? 0
	const clipHeight = offset?.height ?? yAxis?.height ?? props?.height ?? 0

	return (
		<>
			<defs>
				<clipPath id={clipId}>
					<rect x={clipX} y={clipY} width={clipWidth} height={clipHeight} />
				</clipPath>
			</defs>
			<g clipPath={`url(#${clipId})`}>
				{data.map((point: any) =>
					tasks.map((task: SPPingTask) => {
						const meta = point.meta?.[task.id]
						if (!meta) return null
						const x = xScale(point.time) - width / 2
						const ranges = [
							{ from: meta.min, to: meta.max, color: '#d1d5db', opacity: 0.24 },
							{ from: meta.p10, to: meta.p90, color: getLossColor(meta.lossRate), opacity: 0.32 },
							{ from: meta.p25, to: meta.p75, color: getLossColor(meta.lossRate), opacity: 0.42 }
						]
						return ranges.map((r, idx) => {
							if (r.from === null || r.to === null) return null
							const y1 = yScale(r.from)
							const y2 = yScale(r.to)
							const y = Math.min(y1, y2)
							const h = Math.abs(y2 - y1)
							if (!Number.isFinite(y) || !Number.isFinite(h)) return null
							return <rect key={`${point.time}-${task.id}-${idx}`} x={x} y={y} width={width} height={Math.max(h, 1)} fill={r.color} fillOpacity={r.opacity} />
						})
					})
				)}
			</g>
		</>
	)
}

const SpPingChart = ({ node, hours }: { node: NodeData; hours: number }) => {
	const { history, loading, error } = useSpPingChart(node, hours)
	const tasks = history?.tasks || []
	const [showSmoke, setShowSmoke] = useState(true)
	const [sortKey, setSortKey] = useState<'default' | 'name' | 'latency' | 'loss'>('default')
	const [sortOrder, setSortOrder] = useState<'none' | 'asc' | 'desc'>('none')
	const [filterKey, setFilterKey] = useState<'all' | 'with_loss' | 'without_loss'>('all')

	const chartData = useMemo(() => buildChartData(history?.records || []), [history?.records])
	const summaries = useMemo(() => buildTaskSummary(history?.records || [], tasks), [history?.records, tasks])
	const summaryById = useMemo(() => new Map(summaries.map(s => [s.id, s] as const)), [summaries])
	const colorByTaskId = useMemo(() => new Map(tasks.map((t, idx) => [t.id, colors[idx % colors.length]] as const)), [tasks])

	const toggleSort = (key: 'default' | 'name' | 'latency' | 'loss') => {
		if (key === 'default') {
			setSortKey('default')
			setSortOrder('none')
			return
		}
		if (sortKey !== key) {
			setSortKey(key)
			setSortOrder('asc')
			return
		}
		if (sortOrder === 'asc') {
			setSortOrder('desc')
			return
		}
		setSortKey('default')
		setSortOrder('none')
	}

	const seriesByTask = useMemo(() => {
		const map = new Map<
			number,
			{
				data: any[]
				yRange: [number, number] | null
				yDigits: number
			}
		>()
		for (const task of tasks) {
			const data: any[] = []
			let minV: number | null = null
			let maxV: number | null = null
			for (const point of chartData) {
				const meta = point.meta?.[task.id]
				if (!meta) continue
				data.push({
					time: point.time,
					meta: { [task.id]: meta },
					[`${task.id}_p10`]: meta.p10,
					[`${task.id}_band`]: meta.p90 !== null && meta.p10 !== null ? meta.p90 - meta.p10 : null,
					[`${task.id}_median`]: meta.median
				})
				const candidates = [meta.p10, meta.median, meta.p90].filter(v => v !== null) as number[]
				for (const v of candidates) {
					minV = minV === null || v < minV ? v : minV
					maxV = maxV === null || v > maxV ? v : maxV
				}
				if (minV === null && meta.min !== null) minV = meta.min
				if (maxV === null && meta.max !== null) maxV = meta.max
			}
			let yRange: [number, number] | null = null
			let yDigits = 0
			if (minV !== null && maxV !== null) {
				yRange = calcNiceLatencyDomain(minV, maxV)
				yDigits = calcLatencyTickDigits(yRange)
			}
			map.set(task.id, { data, yRange, yDigits })
		}
		return map
	}, [chartData, tasks])

	const displayedTasks = useMemo(() => {
		const base = tasks.filter(t => {
			const series = seriesByTask.get(t.id)
			return !!series?.data?.length
		})

		const filtered = base.filter(t => {
			if (filterKey === 'all') return true
			const lossRate = summaryById.get(t.id)?.lossRate ?? 0
			if (filterKey === 'with_loss') return lossRate > 0
			return lossRate <= 0
		})

		if (sortKey === 'default' || sortOrder === 'none') return filtered

		const withIndex = filtered.map((t, idx) => ({ t, idx }))
		const nameKey = (t: SPPingTask) => (t.name || '').trim()
		const latencyKey = (t: SPPingTask) => {
			const s = summaryById.get(t.id)
			return s?.medianNow ?? s?.medianAvg ?? s?.avg ?? -1
		}
		const lossKey = (t: SPPingTask) => summaryById.get(t.id)?.lossRate ?? -1

		withIndex.sort((a, b) => {
			const dir = sortOrder === 'asc' ? 1 : -1
			switch (sortKey) {
				case 'name': {
					const diff = nameKey(a.t).localeCompare(nameKey(b.t), undefined, { numeric: true, sensitivity: 'base' })
					return diff !== 0 ? diff * dir : a.idx - b.idx
				}
				case 'latency': {
					const diff = latencyKey(a.t) - latencyKey(b.t)
					return diff !== 0 ? diff * dir : a.idx - b.idx
				}
				case 'loss': {
					const diff = lossKey(a.t) - lossKey(b.t)
					return diff !== 0 ? diff * dir : a.idx - b.idx
				}
				default:
					return a.idx - b.idx
			}
		})

		return withIndex.map(x => x.t)
	}, [tasks, seriesByTask, summaryById, sortKey, filterKey])

	const sortBadge = (key: typeof sortKey) => {
		if (key === 'default' || sortKey !== key || sortOrder === 'none') return ''
		return sortOrder === 'asc' ? '↑' : '↓'
	}
	const sortActive = (key: typeof sortKey) => {
		if (key === 'default') return sortKey === 'default' || sortOrder === 'none'
		return sortKey === key && sortOrder !== 'none'
	}
	const sortBtnClass = (key: typeof sortKey) =>
		`h-7 px-2.5 text-xs rounded-full border transition-all whitespace-nowrap ${
			sortActive(key) ? 'bg-(--accent-a7)/70 border-(--accent-a9)' : 'border-(--accent-a6)/60 hover:bg-(--accent-a5)/50'
		}`
	const filterBtnClass = (active: boolean) =>
		`h-7 px-2.5 text-xs rounded-full border transition-all whitespace-nowrap ${
			active ? 'bg-(--accent-a7)/70 border-(--accent-a9)' : 'border-(--accent-a6)/60 hover:bg-(--accent-a5)/50'
		}`

	const rangeText = useMemo(() => {
		const from = history?.from || (chartData[0]?.time ? new Date(chartData[0].time).toISOString() : '')
		const to = history?.to || (chartData[chartData.length - 1]?.time ? new Date(chartData[chartData.length - 1].time).toISOString() : '')
		if (!from || !to) return ''
		return `${new Date(from).toLocaleString()} ~ ${new Date(to).toLocaleString()}`
	}, [history?.from, history?.to, chartData])

	if (loading) {
		return (
			<div className="h-96 w-full flex items-center justify-center">
				<Loading />
			</div>
		)
	}

	if (error) {
		return <div className="h-96 w-full flex items-center justify-center text-destructive">错误: {error}</div>
	}

	if (!history || tasks.length === 0) {
		return <div className="h-48 w-full flex items-center justify-center text-muted-foreground">暂无多样本延迟数据</div>
	}

	return (
		<div className="w-full space-y-3">
			<Card className="p-4 space-y-3">
				<div className="text-xs text-(--theme-text-muted-color)">时间范围：{rangeText || '—'}</div>
				<div className="flex flex-wrap items-center gap-2">
					<div className="text-xs text-(--theme-text-muted-color) shrink-0">排序</div>
					<Button variant="ghost" size="sm" className={sortBtnClass('default')} onClick={() => toggleSort('default')}>
						默认排序
					</Button>
					<Button variant="ghost" size="sm" className={sortBtnClass('name')} onClick={() => toggleSort('name')}>
						按名称{sortBadge('name') ? ` ${sortBadge('name')}` : ''}
					</Button>
					<Button variant="ghost" size="sm" className={sortBtnClass('latency')} onClick={() => toggleSort('latency')}>
						按延迟{sortBadge('latency') ? ` ${sortBadge('latency')}` : ''}
					</Button>
					<Button variant="ghost" size="sm" className={sortBtnClass('loss')} onClick={() => toggleSort('loss')}>
						按丢包{sortBadge('loss') ? ` ${sortBadge('loss')}` : ''}
					</Button>
					<div className="h-5 w-px bg-(--accent-a5)/40 shrink-0 mx-1" />
					<div className="text-xs text-(--theme-text-muted-color) shrink-0">过滤</div>
					<Button variant="ghost" size="sm" className={filterBtnClass(filterKey === 'all')} onClick={() => setFilterKey('all')}>
						全部
					</Button>
					<Button variant="ghost" size="sm" className={filterBtnClass(filterKey === 'with_loss')} onClick={() => setFilterKey('with_loss')}>
						只看有丢包
					</Button>
					<Button variant="ghost" size="sm" className={filterBtnClass(filterKey === 'without_loss')} onClick={() => setFilterKey('without_loss')}>
						只看无丢包
					</Button>
					<div className="ml-auto flex items-center gap-2 text-sm shrink-0">
						<Switch id="smoke" checked={showSmoke} onCheckedChange={setShowSmoke} />
						<label htmlFor="smoke" className="cursor-pointer select-none text-xs text-(--theme-text-muted-color) whitespace-nowrap">
							显示烟雾分布
						</label>
					</div>
				</div>
			</Card>
			<div className="grid grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-3">
				{displayedTasks.map((task, idx) => {
					const summary = summaries.find(s => s.id === task.id)
					const series = seriesByTask.get(task.id)
					const color = colorByTaskId.get(task.id) || colors[idx % colors.length]
					if (!series || !series.data.length) return null
					const lossLabel = summary && Number.isFinite(summary.lossRate) ? `${summary.lossRate.toFixed(2)}% (${summary.loss}/${summary.total})` : '—'
					const lossColor = summary ? getLossColor(summary.lossRate) : 'var(--theme-text-muted-color)'
					const medianItems = summary
						? ([
								{ k: 'max', v: formatLatency(summary.medianMax) },
								{ k: 'min', v: formatLatency(summary.medianMin) },
								{ k: 'now', v: formatLatency(summary.medianNow) },
								{ k: 'sd', v: formatLatency(summary.medianSd) }
						  ] as const)
						: []
					const lossItems = summary
						? ([
								{ k: 'max', v: formatLoss(summary.lossMax) },
								{ k: 'min', v: formatLoss(summary.lossMin) },
								{ k: 'now', v: formatLoss(summary.lossNow) }
						  ] as const)
						: []

					return (
						<Card key={task.id} className="p-3 space-y-2">
							<div className="flex items-center justify-between gap-2">
								<div className="flex items-center gap-2 min-w-0">
									<div className="w-2 h-6 rounded-full shrink-0" style={{ backgroundColor: color }}></div>
									<div className="min-w-0 flex items-center gap-2">
										<div className="font-semibold text-secondary-foreground truncate">{task.name}</div>
										<div className="text-xs text-(--theme-text-muted-color) shrink-0">
											周期 {task.bucket || task.step}s / {task.pings} 包
										</div>
									</div>
								</div>
								<div className="flex items-center gap-2 shrink-0">
									<span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-(--accent-a3) bg-(--accent-a2) text-xs text-secondary-foreground tabular-nums">
										<span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: lossColor }} />
										丢包 {lossLabel}
									</span>
									<Tips
										side="left"
										mode="auto"
										contentMinWidth="12rem"
										contentMaxWidth="20rem"
										trigger={<HelpCircle size={16} color="var(--theme-text-muted-color)" />}>
										<div className="space-y-2">
											<div className="text-sm font-semibold">丢包颜色说明</div>
											<div className="text-xs text-(--theme-text-muted-color)">按时间范围内丢包率区间着色（用于烟雾分布与分位带）。</div>
											<div className="grid grid-cols-2 gap-1.5">
												{lossColorSteps.map(step => (
													<div
														key={step.label}
														className="flex items-center gap-2 px-2 py-1 rounded-md border border-(--accent-a3) bg-(--accent-a2) text-xs text-secondary-foreground">
														<span className="w-3 h-3 rounded-sm" style={{ backgroundColor: step.color }} />
														<span className="tabular-nums">
															{step.label}
															{step.label.includes('/') ? '' : '%'}
														</span>
													</div>
												))}
											</div>
										</div>
									</Tips>
								</div>
							</div>

							<div className="grid grid-cols-1 gap-2">
								<div className="rounded-md border border-(--accent-a3) bg-(--accent-a2) px-2 py-2">
									<div className="flex items-center justify-between gap-2">
										<div className="text-[11px] font-medium text-(--theme-text-muted-color) tracking-wide">Median RTT</div>
										<div className="text-xs font-semibold text-secondary-foreground tabular-nums">
											{summary ? 'avg ' + formatLatency(summary.medianAvg) : '—'}
										</div>
									</div>
									<div className="mt-1 flex flex-wrap gap-1.5">
										{medianItems.length ? (
											medianItems.map(item => (
												<span
													key={item.k}
													className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-(--accent-a3) text-[11px] text-secondary-foreground tabular-nums">
													<span className="text-(--theme-text-muted-color)">{item.k}</span>
													<span>{item.v}</span>
												</span>
											))
										) : (
											<span className="text-xs text-(--theme-text-muted-color)">—</span>
										)}
									</div>
								</div>

								<div className="rounded-md border border-(--accent-a3) bg-(--accent-a2) px-2 py-2">
									<div className="flex items-center justify-between gap-2">
										<div className="text-[11px] font-medium text-(--theme-text-muted-color) tracking-wide">Packet Loss</div>
										<div className="text-xs font-semibold text-secondary-foreground tabular-nums">
											{summary ? 'avg ' + formatLoss(summary.lossAvg) : '—'}
										</div>
									</div>
									<div className="mt-1 flex flex-wrap gap-1.5">
										{lossItems.length ? (
											lossItems.map(item => (
												<span
													key={item.k}
													className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-(--accent-a3) text-[11px] text-secondary-foreground tabular-nums">
													<span className="text-(--theme-text-muted-color)">{item.k}</span>
													<span>{item.v}</span>
												</span>
											))
										) : (
											<span className="text-xs text-(--theme-text-muted-color)">—</span>
										)}
									</div>
								</div>
							</div>
							<div style={{ width: '100%', height: 320 }}>
								<ResponsiveContainer>
									<ComposedChart data={series.data} margin={{ top: 6, right: 14, bottom: 4, left: 12 }}>
										<CartesianGrid strokeDasharray="2 4" stroke="var(--theme-line-muted-color)" vertical strokeOpacity={0.35} />
										<XAxis
											type="number"
											dataKey="time"
											domain={['dataMin', 'dataMax']}
											tickLine={false}
											axisLine={false}
											minTickGap={18}
											scale="time"
											tickFormatter={value => formatTimeLabel(value, hours)}
										/>
										<YAxis
											tickLine={false}
											axisLine={false}
											unit=" ms"
											width={46}
											allowDecimals
											tickCount={6}
											tick={{ dx: -6, fill: 'var(--theme-text-muted-color)', fontSize: 11 }}
											tickFormatter={v => (Number.isFinite(v) ? Number(v).toFixed(series.yDigits) : '')}
											domain={series.yRange || undefined}
										/>
										<Tooltip
											cursor={{ stroke: 'var(--accent-a5)', strokeOpacity: 0.5, strokeDasharray: '4 4' }}
											content={({ active, payload, label }) => {
												if (!active || !payload?.length) return null
												const meta = (payload[0].payload as ChartPoint).meta
												const s = meta?.[task.id]
												if (!s) return null
												return (
													<div className="rounded-lg bg-background/95 shadow-lg border border-(--accent-a3) px-3 py-2 space-y-1 text-xs">
														<div className="text-[11px] text-muted-foreground">{formatTimeLabel(label as number, hours, true)}</div>
														<div className="flex items-center gap-2">
															<span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: color }}></span>
															<span className="font-medium">{task.name}</span>
														</div>
														<div>中位 {formatLatency(s.median)}</div>
														<div className="text-muted-foreground">p10~p90 {formatRange(s.p10, s.p90)}</div>
														<div className="text-muted-foreground">min~max {formatRange(s.min, s.max)}</div>
														<div className="text-muted-foreground">丢包 {s.lossRate.toFixed(2)}%</div>
													</div>
												)
											}}
										/>
										<Customized component={<SmokeLayer data={series.data} tasks={[task]} showSmoke={showSmoke} />} />
										{!showSmoke && (
											<>
												<Area
													type="monotone"
													dataKey={`${task.id}_p10`}
													stackId={`base-${task.id}`}
													stroke="transparent"
													fill="transparent"
													isAnimationActive={false}
													connectNulls
												/>
												<Area
													type="monotone"
													dataKey={`${task.id}_band`}
													stackId={`base-${task.id}`}
													stroke="none"
													fill={color}
													fillOpacity={0.16}
													isAnimationActive={false}
													connectNulls
												/>
											</>
										)}
										<Line
											type="monotone"
											dataKey={`${task.id}_median`}
											stroke={color}
											strokeWidth={2}
											dot={false}
											isAnimationActive={false}
											connectNulls
										/>
									</ComposedChart>
								</ResponsiveContainer>
							</div>
						</Card>
					)
				})}
			</div>
		</div>
	)
}

export default SpPingChart
