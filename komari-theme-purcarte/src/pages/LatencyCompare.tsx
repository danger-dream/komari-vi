import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ChevronDown, ChevronRight, Globe, Layers, List, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import Loading from '@/components/loading'
import Flag from '@/components/sections/Flag'
import Tips from '@/components/ui/tips'
import { useNodeData } from '@/contexts/NodeDataContext'
import { useSpPingChart } from '@/hooks/useSpPingChart'
import { getRegionDisplayName, sortByRegionPriority } from '@/utils/regionHelper'
import type { NodeData, SPPingRecord, SPPingTask } from '@/types/node'
import { Area, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

type GroupMode = 'none' | 'region' | 'group'
type SortKey = 'default' | 'name' | 'latency' | 'loss'
type SortOrder = 'none' | 'asc' | 'desc'
type FilterKey = 'all' | 'with_loss' | 'without_loss'

type TimeRangeOption = { label: string; hours: number }

const timeRanges: TimeRangeOption[] = [
	{ label: '3h', hours: 3 },
	{ label: '6h', hours: 6 },
	{ label: '12h', hours: 12 },
	{ label: '1d', hours: 24 },
	{ label: '3d', hours: 72 },
	{ label: '5d', hours: 120 },
	{ label: '7d', hours: 168 }
]

const columnColors = ['#5A9A90', '#6B9D77', '#7A6FC0', '#D17A6A', '#C87BA0', '#D9924A', '#5FB5D0', '#D9B558']

const lossColorSteps = [
	{ label: '0', max: 0, color: '#388E3C' },
	{ label: '1', max: 1, color: '#1976D2' },
	{ label: '2', max: 2, color: '#7B1FA2' },
	{ label: '3', max: 3, color: '#F9A825' },
	{ label: '4-5', max: 5, color: '#F57C00' },
	{ label: '6-10', max: 10, color: '#E64A19' },
	{ label: '11-19', max: 19, color: '#D32F2F' },
	{ label: '20/20', max: 100, color: '#B71C1C' }
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
	lossRecent: number | null
	lossP95: number | null
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
		const prev = statsMap.get(rec.task_id) || {
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
		const lossRatesSorted = [...s.lossRates].sort((a, b) => a - b)
		const lossP95 = percentile(lossRatesSorted, 0.95)
		const recentWindow = 5
		const recentSlice = s.lossRates.slice(Math.max(0, s.lossRates.length - recentWindow))
		const lossRecent = recentSlice.length ? recentSlice.reduce((a, b) => a + b, 0) / recentSlice.length : null
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
			lossNow: lossStats.now,
			lossRecent,
			lossP95
		}
	})
}

const formatLatency = (v: number | null | undefined, digits = 2) => {
	if (v === null || v === undefined || Number.isNaN(v)) return '—'
	if (v < 1) {
		const us = v * 1000
		return `${us.toFixed(us < 10 ? 2 : 0)} us`
	}
	return `${v.toFixed(digits)} ms`
}

const getLossColor = (lossRate: number) => {
	const rate = Math.max(0, Math.min(100, lossRate))
	return lossColorSteps.find(step => rate <= step.max)?.color || lossColorSteps[lossColorSteps.length - 1].color
}

type SeriesPoint = {
	time: number
	p10: number | null
	band: number | null
	median: number | null
	min: number | null
	max: number | null
	lossRate: number
}

const buildSeriesByTask = (records: SPPingRecord[]) => {
	const byTask = new Map<number, SeriesPoint[]>()
	for (const rec of records) {
		const ts = new Date(rec.time).getTime()
		const s = deriveStats(rec)
		const p10 = s.p10
		const band = s.p10 !== null && s.p90 !== null ? s.p90 - s.p10 : null
		const median = s.median
		if (!byTask.has(rec.task_id)) byTask.set(rec.task_id, [])
		byTask.get(rec.task_id)!.push({ time: ts, p10, band, median, min: s.min, max: s.max, lossRate: s.lossRate })
	}
	for (const points of byTask.values()) {
		points.sort((a, b) => a.time - b.time)
	}
	return byTask
}

const compareLatencyAvg = (summary: TaskSummary | null) => summary?.medianAvg ?? summary?.avg ?? null

const compareJitterSd = (summary: TaskSummary | null) => summary?.medianSd ?? null

const compareLatencyRange = (summary: TaskSummary | null) => {
	const min = summary?.medianMin
	const max = summary?.medianMax
	if (typeof min !== 'number' || typeof max !== 'number') return null
	if (min < 0 || max < 0) return null
	return Math.max(0, max - min)
}

type CompareCandidate = {
	colIdx: number
	uuid: string
	nodeName: string
	lossRate: number | null
	lossNow: number | null
	lossRecent: number | null
	lossMax: number | null
	lossP95: number | null
	lossCount: number | null
	totalCount: number | null
	latencyAvg: number | null
	jitterSd: number | null
	latencyRange: number | null
}

type TaskCompareInfo = {
	taskId: number
	winnerColIdx: number
	candidates: CompareCandidate[]
	breakdowns: CompareBreakdown[]
	params: CompareParams
}

type CompareParams = {
	priorStrength: number
	stabilityWeight: number
	lossWeightPerPct: number
	lossNowWeight: number
	lossPeakWeight: number
	uncertaintyMaxMs: number
}

type CompareBreakdown = {
	colIdx: number
	uuid: string
	nodeName: string
	totalCount: number
	lossCount: number
	lossRateRawPct: number
	lossBaselinePct: number
	lossSmoothedPct: number
	lossNowPct: number
	lossRecentPct: number
	lossPeakMaxPct: number
	lossPeakP95Pct: number
	lossEffectivePct: number
	latencyAvgMs: number
	jitterSdMs: number
	latencyRangeMs: number
	stabilityPenaltyMs: number
	lossPenaltyMs: number
	uncertaintyPenaltyMs: number
	scoreMs: number
}

const scoreCandidates = (candidates: CompareCandidate[]) => {
	const getNum = (v: number | null) => (typeof v === 'number' ? v : Infinity)
	const stabilityPenalty = (c: CompareCandidate) => {
		const sd = getNum(c.jitterSd)
		const range = getNum(c.latencyRange)
		return Math.max(sd, range / 2)
	}

	const params: CompareParams = {
		// 经验贝叶斯收缩强度：数值越大，小样本越被“拉回”基线；越小则更信任小样本
		priorStrength: 500,
		// 稳定性权重：越大越倾向“稳定胜过低均值”
		stabilityWeight: 0.8,
		// 丢包惩罚：每 1% 的“有效丢包率”折算为多少扣分（越大越重视丢包）
		// 经验值：50 表示 1% 丢包约等价 50ms 延迟劣化；10% 则约 500ms 扣分
		lossWeightPerPct: 50,
		// 近期/尾部惩罚权重：用于区分“近期变差”与“偶发尖峰”
		// 采用 recent(最近窗口均值) 与 p95(95分位) 替代 last/max，避免单点尖峰左右结果
		lossNowWeight: 0.35,
		lossPeakWeight: 0.15,
		// 小样本保守惩罚的上限（ms）
		uncertaintyMaxMs: 6
	}

	const baselineLossRatePct = (() => {
		let lossSum = 0
		let totalSum = 0
		for (const c of candidates) {
			if (typeof c.lossCount !== 'number' || typeof c.totalCount !== 'number' || c.totalCount <= 0) continue
			lossSum += Math.max(0, c.lossCount)
			totalSum += Math.max(0, c.totalCount)
		}
		if (totalSum <= 0) return 0
		return (lossSum / totalSum) * 100
	})()

	const smoothLossRatePct = (c: CompareCandidate) => {
		const total = typeof c.totalCount === 'number' && c.totalCount > 0 ? c.totalCount : 0
		const loss = typeof c.lossCount === 'number' && c.lossCount > 0 ? c.lossCount : 0
		// 经验贝叶斯：用同任务的“基线丢包率”作为先验均值，并用固定强度进行收缩
		// 直觉：total 很小（比如 50）时，2 次丢包不应把它直接打成 4%，而应更接近该任务的总体水平
		const priorLoss = (params.priorStrength * baselineLossRatePct) / 100
		const denom = total + params.priorStrength
		if (denom <= 0) return baselineLossRatePct
		return ((loss + priorLoss) / denom) * 100
	}

	const lossRateEffective = (c: CompareCandidate) => {
		const overall = Math.max(0, Math.min(100, smoothLossRatePct(c)))
		const recent = Math.max(0, Math.min(100, typeof c.lossRecent === 'number' ? c.lossRecent : typeof c.lossNow === 'number' ? c.lossNow : overall))
		const peakP95 = Math.max(0, Math.min(100, typeof c.lossP95 === 'number' ? c.lossP95 : overall))
		// 基于整体丢包率为主，近期与尾部作为附加惩罚（避免只看均值掩盖“持续变差/高分位劣化”）
		const extraNow = Math.max(0, recent - overall) * params.lossNowWeight
		const extraPeak = Math.max(0, peakP95 - overall) * params.lossPeakWeight
		return overall + extraNow + extraPeak
	}

	const lossPenaltyMs = (lossRate: number) => {
		// 用更直观的线性扣分，避免出现“2 万 ms”这种难以理解的数字；但仍然让中高丢包强烈影响胜负
		const r = Math.max(0, Math.min(100, lossRate))
		return params.lossWeightPerPct * r
	}

	const uncertaintyPenaltyMs = (c: CompareCandidate) => {
		const total = typeof c.totalCount === 'number' && c.totalCount > 0 ? c.totalCount : 0
		const w = params.priorStrength / (total + params.priorStrength)
		// 小样本时稍微“保守”一点，避免 50 包的数据轻易碾压 5000 包
		return params.uncertaintyMaxMs * w
	}

	const breakdowns: CompareBreakdown[] = candidates.map(c => {
		const totalCount = typeof c.totalCount === 'number' && c.totalCount > 0 ? c.totalCount : 0
		const lossCount = typeof c.lossCount === 'number' && c.lossCount > 0 ? c.lossCount : 0
		const lossRateRawPct = totalCount > 0 ? (lossCount / totalCount) * 100 : 0
		const lossSmoothedPct = smoothLossRatePct(c)
		const effective = lossRateEffective(c)
		const latencyAvgMs = getNum(c.latencyAvg)
		const jitterSdMs = getNum(c.jitterSd)
		const latencyRangeMs = getNum(c.latencyRange)
		const stabilityPenaltyMs = stabilityPenalty(c)
		const lossPenalty = lossPenaltyMs(effective)
		const uncertaintyPenalty = uncertaintyPenaltyMs(c)
		const scoreMs = latencyAvgMs + params.stabilityWeight * stabilityPenaltyMs + lossPenalty + uncertaintyPenalty

		return {
			colIdx: c.colIdx,
			uuid: c.uuid,
			nodeName: c.nodeName,
			totalCount,
			lossCount,
			lossRateRawPct,
			lossBaselinePct: baselineLossRatePct,
			lossSmoothedPct,
			lossNowPct: typeof c.lossNow === 'number' ? c.lossNow : lossSmoothedPct,
			lossRecentPct: typeof c.lossRecent === 'number' ? c.lossRecent : typeof c.lossNow === 'number' ? c.lossNow : lossSmoothedPct,
			lossPeakMaxPct: typeof c.lossMax === 'number' ? c.lossMax : lossSmoothedPct,
			lossPeakP95Pct: typeof c.lossP95 === 'number' ? c.lossP95 : lossSmoothedPct,
			lossEffectivePct: effective,
			latencyAvgMs,
			jitterSdMs,
			latencyRangeMs,
			stabilityPenaltyMs,
			lossPenaltyMs: lossPenalty,
			uncertaintyPenaltyMs: uncertaintyPenalty,
			scoreMs
		}
	})

	const sorted = [...candidates].sort((a, b) => {
		const sa = getNum(a.latencyAvg) + params.stabilityWeight * stabilityPenalty(a) + lossPenaltyMs(lossRateEffective(a)) + uncertaintyPenaltyMs(a)
		const sb = getNum(b.latencyAvg) + params.stabilityWeight * stabilityPenalty(b) + lossPenaltyMs(lossRateEffective(b)) + uncertaintyPenaltyMs(b)
		if (sa !== sb) return sa - sb
		return a.colIdx - b.colIdx
	})
	const winnerColIdx = sorted[0]?.colIdx ?? -1

	return { winnerColIdx, breakdowns, params }
}

const popcount = (n: number) => {
	let x = n
	let c = 0
	while (x) {
		c += x & 1
		x >>= 1
	}
	return c
}

const maskFirstLast = (mask: number, n: number) => {
	let first = -1
	let last = -1
	for (let i = 0; i < n; i++) {
		if (mask & (1 << i)) {
			if (first === -1) first = i
			last = i
		}
	}
	return { first, last }
}

type NodeCtx = {
	node: NodeData
	taskById: Map<number, SPPingTask>
	summaryById: Map<number, TaskSummary>
	seriesByTaskId: Map<number, SeriesPoint[]>
}

type CompareCell = {
	taskId: number
	taskName: string
	summary: TaskSummary | null
} | null

type CompareRow = {
	key: string
	mask: number
	cells: CompareCell[]
}

type CompareGroup = {
	key: string
	mask: number | null
	rows: CompareRow[]
}

const LatencyCompare = () => {
	const { nodes, loading: nodesLoading } = useNodeData()
	const nodeList = Array.isArray(nodes) ? nodes : []

	const [hours, setHours] = useState<number>(3)
	const [nodeSearch, setNodeSearch] = useState('')
	const [groupMode, setGroupMode] = useState<GroupMode>('region')
	const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
	const [selectedUuids, setSelectedUuids] = useState<string[]>([])

	const [filterKey, setFilterKey] = useState<FilterKey>('all')
	const [sortNodeUuid, setSortNodeUuid] = useState<string | null>(null)
	const [sortKey, setSortKey] = useState<SortKey>('default')
	const [sortOrder, setSortOrder] = useState<SortOrder>('none')
	const [autoCompare, setAutoCompare] = useState(true)

	const [pageHeight, setPageHeight] = useState<number | null>(null)
	const compareViewportRef = useRef<HTMLDivElement | null>(null)
	const compareCardMinHeight = 198
	const [availableWidth, setAvailableWidth] = useState(0)
	const minColumnWidth = 450
	const columnGapPx = 12 // gap-3

	// 动态计算最大列数，至少3列
	const maxColumns = useMemo(() => {
		if (availableWidth === 0) return 3
		// Card 有 p-4 padding (16px on each side = 32px total)
		const cardPadding = 32
		const effectiveWidth = availableWidth - cardPadding
		const calculated = Math.floor((effectiveWidth + columnGapPx) / (minColumnWidth + columnGapPx))
		return Math.max(3, calculated)
	}, [availableWidth])

	const selectedNodes = useMemo(() => selectedUuids.map(uuid => nodeList.find(n => n.uuid === uuid) || null), [selectedUuids, nodeList])

	// 预创建足够的slots（最多支持20列，这应该足够大了）
	const slot0 = selectedNodes[0] || null
	const slot1 = selectedNodes[1] || null
	const slot2 = selectedNodes[2] || null
	const slot3 = selectedNodes[3] || null
	const slot4 = selectedNodes[4] || null
	const slot5 = selectedNodes[5] || null
	const slot6 = selectedNodes[6] || null
	const slot7 = selectedNodes[7] || null
	const slot8 = selectedNodes[8] || null
	const slot9 = selectedNodes[9] || null
	const slot10 = selectedNodes[10] || null
	const slot11 = selectedNodes[11] || null
	const slot12 = selectedNodes[12] || null
	const slot13 = selectedNodes[13] || null
	const slot14 = selectedNodes[14] || null
	const slot15 = selectedNodes[15] || null
	const slot16 = selectedNodes[16] || null
	const slot17 = selectedNodes[17] || null
	const slot18 = selectedNodes[18] || null
	const slot19 = selectedNodes[19] || null

	const sp0 = useSpPingChart(slot0, hours)
	const sp1 = useSpPingChart(slot1, hours)
	const sp2 = useSpPingChart(slot2, hours)
	const sp3 = useSpPingChart(slot3, hours)
	const sp4 = useSpPingChart(slot4, hours)
	const sp5 = useSpPingChart(slot5, hours)
	const sp6 = useSpPingChart(slot6, hours)
	const sp7 = useSpPingChart(slot7, hours)
	const sp8 = useSpPingChart(slot8, hours)
	const sp9 = useSpPingChart(slot9, hours)
	const sp10 = useSpPingChart(slot10, hours)
	const sp11 = useSpPingChart(slot11, hours)
	const sp12 = useSpPingChart(slot12, hours)
	const sp13 = useSpPingChart(slot13, hours)
	const sp14 = useSpPingChart(slot14, hours)
	const sp15 = useSpPingChart(slot15, hours)
	const sp16 = useSpPingChart(slot16, hours)
	const sp17 = useSpPingChart(slot17, hours)
	const sp18 = useSpPingChart(slot18, hours)
	const sp19 = useSpPingChart(slot19, hours)

	const allHistories = [sp0, sp1, sp2, sp3, sp4, sp5, sp6, sp7, sp8, sp9, sp10, sp11, sp12, sp13, sp14, sp15, sp16, sp17, sp18, sp19]

	const selectedCtxs = useMemo(() => {
		return selectedNodes
			.map((node, idx) => {
				if (!node) return null
				const history = allHistories[idx]?.history
				const tasks = history?.tasks || []
				const records = history?.records || []
				const summaries = buildTaskSummary(records, tasks)
				return {
					node,
					taskById: new Map(tasks.map(t => [t.id, t] as const)),
					summaryById: new Map(summaries.map(s => [s.id, s] as const)),
					seriesByTaskId: buildSeriesByTask(records)
				} satisfies NodeCtx
			})
			.filter((ctx): ctx is NodeCtx => ctx !== null)
	}, [selectedNodes, ...allHistories.map(h => h.history)])

	useLayoutEffect(() => {
		const headerEl = document.querySelector('header') as HTMLElement | null
		const footerEl = document.querySelector('footer') as HTMLElement | null

		const compute = () => {
			const vh = window.innerHeight || 0
			const headerH = headerEl?.getBoundingClientRect().height ?? 0
			const footerH = footerEl?.getBoundingClientRect().height ?? 0
			const h = Math.max(260, Math.floor(vh - headerH - footerH))
			setPageHeight(h)
		}

		compute()
		const ro = new ResizeObserver(compute)
		if (headerEl) ro.observe(headerEl)
		if (footerEl) ro.observe(footerEl)
		window.addEventListener('resize', compute)
		return () => {
			ro.disconnect()
			window.removeEventListener('resize', compute)
		}
	}, [])

	useEffect(() => {
		const el = compareViewportRef.current
		if (!el) return

		const compute = () => {
			const w = el.clientWidth
			setAvailableWidth(w)
		}

		compute()
		const ro = new ResizeObserver(compute)
		ro.observe(el)
		window.addEventListener('resize', compute)
		return () => {
			ro.disconnect()
			window.removeEventListener('resize', compute)
		}
	}, [])

	useEffect(() => {
		if (sortNodeUuid && !selectedUuids.includes(sortNodeUuid)) {
			setSortNodeUuid(selectedUuids[0] || null)
			setSortKey('default')
			setSortOrder('none')
		}
	}, [selectedUuids, sortNodeUuid])

	const toggleSelectNode = (uuid: string) => {
		setSelectedUuids(prev => {
			const idx = prev.indexOf(uuid)
			if (idx >= 0) {
				const next = [...prev.slice(0, idx), ...prev.slice(idx + 1)]
				if (sortNodeUuid === uuid) {
					setSortNodeUuid(next[0] || null)
					setSortKey('default')
					setSortOrder('none')
				}
				return next
			}
			if (prev.length >= maxColumns) return prev
			const next = [...prev, uuid]
			if (!sortNodeUuid) setSortNodeUuid(uuid)
			return next
		})
	}

	const removeSelected = (uuid: string) => toggleSelectNode(uuid)

	const toggleCollapse = (groupKey: string) => {
		setCollapsedGroups(prev => {
			const next = new Set(prev)
			if (next.has(groupKey)) next.delete(groupKey)
			else next.add(groupKey)
			return next
		})
	}

	const toggleSort = (uuid: string, key: SortKey) => {
		if (key === 'default') {
			setSortNodeUuid(uuid)
			setSortKey('default')
			setSortOrder('none')
			return
		}
		if (sortNodeUuid !== uuid || sortKey !== key) {
			setSortNodeUuid(uuid)
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

	const filteredNodes = useMemo(() => {
		const search = nodeSearch.trim().toLowerCase()
		const base = nodeList
		if (!search) return base
		return base.filter(n => n.name.toLowerCase().includes(search) || n.group?.toLowerCase().includes(search) || n.region?.toLowerCase().includes(search))
	}, [nodeList, nodeSearch])

	const groupedNodes = useMemo(() => {
		if (groupMode === 'none') {
			return [{ key: 'all', title: `全部 (${filteredNodes.length})`, nodes: filteredNodes }]
		}

		if (groupMode === 'region') {
			const map = new Map<string, NodeData[]>()
			for (const n of filteredNodes) {
				const key = n.region || 'unknown'
				if (!map.has(key)) map.set(key, [])
				map.get(key)!.push(n)
			}
			const keys = Array.from(map.keys()).sort(sortByRegionPriority)
			return keys.map(key => ({
				key: `region:${key}`,
				title: `${getRegionDisplayName(key)} (${map.get(key)!.length})`,
				nodes: map.get(key)!
			}))
		}

		const map = new Map<string, NodeData[]>()
		for (const n of filteredNodes) {
			const key = n.group?.trim() ? n.group.trim() : '未分组'
			if (!map.has(key)) map.set(key, [])
			map.get(key)!.push(n)
		}
		const keys = Array.from(map.keys()).sort((a, b) => a.localeCompare(b, 'zh-CN'))
		return keys.map(key => ({
			key: `group:${key}`,
			title: `${key} (${map.get(key)!.length})`,
			nodes: map.get(key)!
		}))
	}, [filteredNodes, groupMode])

	const compareGroups = useMemo<CompareGroup[]>(() => {
		const n = selectedCtxs.length
		if (n === 0) return []

		const sortIndex = sortNodeUuid ? selectedCtxs.findIndex(x => x.node.uuid === sortNodeUuid) : 0
		const activeSortIndex = sortIndex >= 0 ? sortIndex : 0

		type Agg = {
			mask: number
			taskNameByIndex: (string | null)[]
		}

		const aggByTaskId = new Map<number, Agg>()
		for (let i = 0; i < n; i++) {
			const ctx = selectedCtxs[i]
			for (const [id, task] of ctx.taskById.entries()) {
				const prev = aggByTaskId.get(id) || { mask: 0, taskNameByIndex: Array.from({ length: n }, () => null) }
				prev.mask |= 1 << i
				prev.taskNameByIndex[i] = task.name || `任务 ${id}`
				aggByTaskId.set(id, prev)
			}
		}

		const lossFilterPass = (taskId: number) => {
			if (filterKey === 'all') return true
			const lossRates = selectedCtxs.map(ctx => ctx.summaryById.get(taskId)?.lossRate).filter(v => typeof v === 'number') as number[]
			const anyLoss = lossRates.some(v => v > 0)
			if (filterKey === 'with_loss') return anyLoss
			return !anyLoss
		}

		const taskIds = Array.from(aggByTaskId.keys()).filter(lossFilterPass)

		const byMask = new Map<number, number[]>()
		for (const taskId of taskIds) {
			const mask = aggByTaskId.get(taskId)!.mask
			if (!byMask.has(mask)) byMask.set(mask, [])
			byMask.get(mask)!.push(taskId)
		}

		const nameOf = (taskId: number) => {
			const agg = aggByTaskId.get(taskId)
			if (!agg) return `任务 ${taskId}`
			const preferred = agg.taskNameByIndex[activeSortIndex]
			return preferred || agg.taskNameByIndex.find(Boolean) || `任务 ${taskId}`
		}

		const latencyOf = (taskId: number, index: number) => {
			const s = selectedCtxs[index]?.summaryById.get(taskId)
			return s?.medianNow ?? s?.medianAvg ?? s?.avg ?? null
		}

		const lossOf = (taskId: number, index: number) => {
			const s = selectedCtxs[index]?.summaryById.get(taskId)
			return typeof s?.lossRate === 'number' ? s.lossRate : null
		}

		const taskComparator = (a: number, b: number, mask: number) => {
			if (sortKey === 'default' || sortOrder === 'none') return a - b

			const inActive = !!(mask & (1 << activeSortIndex))
			if (!inActive) return a - b
			const dir = sortOrder === 'asc' ? 1 : -1

			if (sortKey === 'name') {
				const diff = nameOf(a).localeCompare(nameOf(b), undefined, { numeric: true, sensitivity: 'base' })
				return diff !== 0 ? diff * dir : a - b
			}

			if (sortKey === 'latency') {
				const va = latencyOf(a, activeSortIndex)
				const vb = latencyOf(b, activeSortIndex)
				const na = va === null ? (sortOrder === 'asc' ? Infinity : -Infinity) : va
				const nb = vb === null ? (sortOrder === 'asc' ? Infinity : -Infinity) : vb
				return na !== nb ? (na - nb) * dir : a - b
			}

			const la = lossOf(a, activeSortIndex)
			const lb = lossOf(b, activeSortIndex)
			const na = la === null ? (sortOrder === 'asc' ? Infinity : -Infinity) : la
			const nb = lb === null ? (sortOrder === 'asc' ? Infinity : -Infinity) : lb
			return na !== nb ? (na - nb) * dir : a - b
		}

		const masks = Array.from(byMask.keys())
		const sharedMasks = masks
			.filter(m => popcount(m) >= 2)
			.sort((a, b) => {
				const ca = popcount(a)
				const cb = popcount(b)
				if (ca !== cb) return cb - ca
				const fa = maskFirstLast(a, n)
				const fb = maskFirstLast(b, n)
				const gapA = fa.last - fa.first
				const gapB = fb.last - fb.first
				if (gapA !== gapB) return gapA - gapB
				if (fa.first !== fb.first) return fa.first - fb.first
				return a - b
			})

		const groups: CompareGroup[] = []
		for (const mask of sharedMasks) {
			const ids = [...(byMask.get(mask) || [])].sort((a, b) => taskComparator(a, b, mask))
			const rows: CompareRow[] = ids.map(id => ({
				key: `m${mask}:${id}`,
				mask,
				cells: Array.from({ length: n }, (_, idx) => {
					const has = !!(mask & (1 << idx))
					if (!has) return null
					const name = aggByTaskId.get(id)?.taskNameByIndex[idx] || nameOf(id)
					return { taskId: id, taskName: name, summary: selectedCtxs[idx].summaryById.get(id) || null }
				})
			}))
			if (rows.length) groups.push({ key: `mask:${mask}`, mask, rows })
		}

		const uniqueLists: number[][] = Array.from({ length: n }, () => [])
		for (const [mask, ids] of byMask.entries()) {
			if (popcount(mask) !== 1) continue
			const idx = Math.log2(mask) | 0
			uniqueLists[idx].push(...ids)
		}

		for (let i = 0; i < n; i++) {
			const list = uniqueLists[i]
			const shouldSort = i === activeSortIndex && sortKey !== 'default' && sortOrder !== 'none'
			const localMask = 1 << i
			list.sort((a, b) => {
				if (!shouldSort) return a - b
				return taskComparator(a, b, localMask)
			})
		}

		const uniqueRows: CompareRow[] = []
		const maxLen = Math.max(...uniqueLists.map(x => x.length), 0)
		for (let r = 0; r < maxLen; r++) {
			uniqueRows.push({
				key: `unique:${r}`,
				mask: 0,
				cells: Array.from({ length: n }, (_, idx) => {
					const id = uniqueLists[idx][r]
					if (!id) return null
					const name = aggByTaskId.get(id)?.taskNameByIndex[idx] || nameOf(id)
					return { taskId: id, taskName: name, summary: selectedCtxs[idx].summaryById.get(id) || null }
				})
			})
		}
		if (uniqueRows.length) groups.push({ key: 'unique', mask: null, rows: uniqueRows })

		return groups
	}, [selectedCtxs, sortNodeUuid, sortKey, sortOrder, filterKey])

	const colCount = selectedCtxs.length
	const taskCompareById = useMemo(() => {
		const n = selectedCtxs.length
		if (!autoCompare || n < 2) return new Map<number, TaskCompareInfo>()

		const byId = new Map<number, TaskCompareInfo>()

		for (const group of compareGroups) {
			if (group.mask === null) continue
			for (const row of group.rows) {
				if (popcount(row.mask) < 2) continue
				const firstCell = row.cells.find((c): c is NonNullable<CompareCell> => !!c)
				if (!firstCell) continue
				const taskId = firstCell.taskId

				const candidates: CompareCandidate[] = []
				for (let colIdx = 0; colIdx < n; colIdx++) {
					const cell = row.cells[colIdx]
					if (!cell) continue
					const node = selectedCtxs[colIdx]?.node
					if (!node) continue
					const summary = cell.summary || null
					candidates.push({
						colIdx,
						uuid: node.uuid,
						nodeName: node.name,
						lossRate: typeof summary?.lossRate === 'number' ? summary.lossRate : null,
						lossNow: typeof summary?.lossNow === 'number' ? summary.lossNow : null,
						lossRecent: typeof summary?.lossRecent === 'number' ? summary.lossRecent : null,
						lossMax: typeof summary?.lossMax === 'number' ? summary.lossMax : null,
						lossP95: typeof summary?.lossP95 === 'number' ? summary.lossP95 : null,
						lossCount: typeof summary?.loss === 'number' ? summary.loss : null,
						totalCount: typeof summary?.total === 'number' ? summary.total : null,
						latencyAvg: compareLatencyAvg(summary),
						jitterSd: compareJitterSd(summary),
						latencyRange: compareLatencyRange(summary)
					})
				}

				if (candidates.length < 2) continue
				const scored = scoreCandidates(candidates)
				byId.set(taskId, { taskId, winnerColIdx: scored.winnerColIdx, candidates, breakdowns: scored.breakdowns, params: scored.params })
			}
		}

		return byId
	}, [autoCompare, compareGroups, selectedCtxs])

	const winStatsByCol = useMemo(() => {
		const n = selectedCtxs.length
		const fullMask = n > 0 ? (1 << n) - 1 : 0
		const base = Array.from({ length: n }, () => ({ wins: 0, total: 0, winsCommon: 0, totalCommon: 0 }))
		if (!autoCompare || n < 2) return base

		for (const group of compareGroups) {
			if (group.mask === null) continue
			for (const row of group.rows) {
				if (popcount(row.mask) < 2) continue
				const taskId = row.cells.find((c): c is NonNullable<CompareCell> => !!c)?.taskId
				if (!taskId) continue
				const compare = taskCompareById.get(taskId)
				if (!compare) continue

				for (let colIdx = 0; colIdx < n; colIdx++) {
					if (!row.cells[colIdx]) continue
					base[colIdx].total += 1
					if (row.mask === fullMask) base[colIdx].totalCommon += 1
				}

				const w = compare.winnerColIdx
				if (w >= 0) {
					base[w].wins += 1
					if (row.mask === fullMask) base[w].winsCommon += 1
				}
			}
		}
		return base
	}, [autoCompare, compareGroups, selectedCtxs.length, taskCompareById])

	const sortBadge = (uuid: string, key: SortKey) => {
		if (!sortNodeUuid || sortNodeUuid !== uuid) return ''
		if (key === 'default' || sortKey !== key || sortOrder === 'none') return ''
		return sortOrder === 'asc' ? '↑' : '↓'
	}

	const sortActive = (uuid: string, key: SortKey) => {
		if (uuid !== sortNodeUuid) return false
		if (key === 'default') return sortKey === 'default' || sortOrder === 'none'
		return sortKey === key && sortOrder !== 'none'
	}

	const sortBtnClass = (uuid: string, key: SortKey) =>
		`h-7 px-2.5 text-xs rounded-full border transition-all whitespace-nowrap ${
			sortActive(uuid, key) ? 'bg-(--accent-a7)/70 border-(--accent-a9)' : 'border-(--accent-a6)/60 hover:bg-(--accent-a5)/50'
		}`

	const filterBtnClass = (active: boolean) =>
		`h-7 px-2.5 text-xs rounded-full border transition-all whitespace-nowrap ${
			active ? 'bg-(--accent-a7)/70 border-(--accent-a9)' : 'border-(--accent-a6)/60 hover:bg-(--accent-a5)/50'
		}`

	if (nodesLoading) {
		return (
			<div className="flex items-center justify-center h-full">
				<Loading text="正在加载节点..." />
			</div>
		)
	}

	const canShow = availableWidth > 0 ? Math.floor((availableWidth + columnGapPx) / (minColumnWidth + columnGapPx)) : 0
	const isOverflowing = colCount > 0 && availableWidth > 0 ? colCount > Math.max(1, canShow) : false
	const widthHint =
		availableWidth > 0 && canShow <= 0
			? `当前可用宽度仅 ${availableWidth}px，单列最小宽度为 ${minColumnWidth}px；已启用横向滚动。`
			: availableWidth > 0 && isOverflowing
			? `当前宽度可同时显示 ${Math.max(1, canShow)} 列，已选择 ${colCount} 列；请横向滚动查看。`
			: ''

	return (
		<div
			className="w-full max-w-none text-card-foreground mx-auto min-h-0 flex flex-col p-4 gap-4 overflow-hidden"
			style={pageHeight ? { height: pageHeight } : undefined}>
			<div className="purcarte-blur theme-card-style p-5 relative border-2 border-(--accent-a5) shadow-lg">
				<div className="flex items-start gap-4">
					<Link
						to="/"
						className="p-3 rounded-lg hover:bg-(--accent-a4) transition-all duration-200 border border-transparent hover:border-(--accent-a6)">
						<ArrowLeft className="size-5" />
					</Link>
					<div>
						<div className="flex items-center gap-2.5 text-xl font-bold">
							<Layers className="size-6 text-primary" />
							<span>延迟监控对比分析</span>
						</div>
						<p className="text-sm text-secondary-foreground mt-1.5">选择多个节点，对齐对比多样本延迟监控数据。ps: 此处对比结果不代表网络最终质量！稳定、延迟低的节点可能带宽不足，也可能在监控目标以外存在其他问题。</p>
					</div>
				</div>
				<div className="mt-4 flex flex-wrap items-center gap-2.5">
					<div className="text-xs text-(--theme-text-muted-color) shrink-0 font-semibold">时间范围</div>
					{timeRanges.map(r => (
						<Button key={r.label} variant="ghost" size="sm" className={filterBtnClass(hours === r.hours)} onClick={() => setHours(r.hours)}>
							{r.label}
						</Button>
					))}
					<div className="h-5 w-px bg-(--accent-a6)/50 shrink-0 mx-1" />
					<div className="text-xs text-(--theme-text-muted-color) shrink-0 font-semibold">过滤</div>
					<Button variant="ghost" size="sm" className={filterBtnClass(filterKey === 'all')} onClick={() => setFilterKey('all')}>
						全部
					</Button>
					<Button variant="ghost" size="sm" className={filterBtnClass(filterKey === 'with_loss')} onClick={() => setFilterKey('with_loss')}>
						只看有丢包
					</Button>
					<Button variant="ghost" size="sm" className={filterBtnClass(filterKey === 'without_loss')} onClick={() => setFilterKey('without_loss')}>
						只看无丢包
					</Button>
					<div className="h-5 w-px bg-(--accent-a6)/50 shrink-0 mx-1" />
					<div className="text-xs text-(--theme-text-muted-color) shrink-0 font-semibold">自动对比</div>
					<Button variant="ghost" size="sm" className={filterBtnClass(autoCompare)} onClick={() => setAutoCompare(prev => !prev)}>
						{autoCompare ? '已开启' : '已关闭'}
					</Button>
					<div className="ml-auto text-xs text-(--theme-text-muted-color) font-medium">
						已选{' '}
						<span className="font-bold text-primary">
							{selectedUuids.length}/{maxColumns}
						</span>
						{sortNodeUuid ? ` · 排序列：${nodeList.find(n => n.uuid === sortNodeUuid)?.name || '—'}` : ''}
					</div>
				</div>
				{!!widthHint && (
					<div className="absolute right-4 top-4 max-w-[60%] rounded-lg border-2 border-destructive/40 bg-destructive/10 backdrop-blur-md px-3 py-2 text-[11px] text-destructive font-medium shadow-lg shadow-destructive/20">
						{widthHint}
					</div>
				)}
			</div>

			<div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-0 min-w-0">
				<Card className="lg:w-96 shrink-0 p-4 flex flex-col min-h-0 border-2 border-(--accent-a5) shadow-lg">
					<div className="space-y-3">
						<div className="flex items-center gap-2">
							<div className="relative flex-1">
								<Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-(--theme-text-muted-color)" />
								<Input
									value={nodeSearch}
									onChange={e => setNodeSearch(e.target.value)}
									placeholder="搜索节点（名称/地域/分组）"
									className="pl-9 h-10 border-2 border-(--accent-a4) focus:border-(--accent-a7) transition-all"
								/>
							</div>
						</div>
						<div className="flex flex-wrap gap-2 pt-2 border-t border-(--accent-a4)/30">
							<div className="w-full text-xs text-(--theme-text-muted-color) font-semibold mb-1">分组模式</div>
							<Button variant="ghost" size="sm" className={filterBtnClass(groupMode === 'none')} onClick={() => setGroupMode('none')}>
								<List className="size-4 mr-1.5" />
								不分组
							</Button>
							<Button variant="ghost" size="sm" className={filterBtnClass(groupMode === 'region')} onClick={() => setGroupMode('region')}>
								<Globe className="size-4 mr-1.5" />
								按地域
							</Button>
							<Button variant="ghost" size="sm" className={filterBtnClass(groupMode === 'group')} onClick={() => setGroupMode('group')}>
								<Layers className="size-4 mr-1.5" />
								按分组
							</Button>
						</div>
					</div>

					<div className="mt-4 flex-1 overflow-y-auto nice-scrollbar pr-1">
						{groupedNodes.map(g => {
							const collapsed = collapsedGroups.has(g.key)
							return (
								<div key={g.key} className="mb-2">
									<button
										type="button"
										onClick={() => toggleCollapse(g.key)}
										className="w-full flex items-center justify-between px-2 py-1.5 rounded hover:bg-(--accent-a3) transition-colors">
										<div className="flex items-center gap-2 text-xs font-semibold text-(--theme-text-muted-color)">
											{collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
											<span>{g.title}</span>
										</div>
									</button>
									{!collapsed && (
										<div className="mt-1 space-y-1 pl-1">
											{g.nodes.map(node => {
												const idx = selectedUuids.indexOf(node.uuid)
												const selected = idx >= 0
												const color = selected ? columnColors[idx % columnColors.length] : undefined
												return (
													<button
														key={node.uuid}
														type="button"
														onClick={() => toggleSelectNode(node.uuid)}
														className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg border transition-all text-left ${
															selected
																? 'bg-(--accent-a4) border-(--accent-a7)'
																: 'border-(--accent-a3) hover:bg-(--accent-a2) hover:border-(--accent-a5)'
														}`}>
														<Flag flag={node.region} />
														<div className="min-w-0 flex-1 truncate text-sm font-medium flex items-center gap-1">
															<span className="truncate">{node.name}</span>
															{selected && color && (
																<span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: color }} />
															)}
														</div>
														{selected && (
															<span className="text-[10px] px-1.5 py-0.5 rounded bg-(--accent-a6) text-white font-bold tabular-nums shrink-0">
																{idx + 1}
															</span>
														)}
														{selectedUuids.length >= maxColumns && !selected && (
															<span className="text-[10px] text-(--theme-text-muted-color) shrink-0">已满</span>
														)}
													</button>
												)
											})}
										</div>
									)}
								</div>
							)
						})}
					</div>
				</Card>

				<Card ref={compareViewportRef} className="flex-1 min-h-0 min-w-0 p-4 flex flex-col overflow-hidden border-2 border-(--accent-a5) shadow-lg">
					{colCount === 0 ? (
						<div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
							<Layers className="size-16 text-(--accent-a6) mb-4 opacity-50" />
							<div className="text-base font-semibold text-(--theme-text-muted-color) mb-2">开始对比分析</div>
							<div className="text-sm text-(--theme-text-muted-color)/70">请先在左侧选择节点开始延迟对比</div>
						</div>
					) : compareGroups.length === 0 ? (
						<div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
							<Globe className="size-16 text-(--accent-a6) mb-4 opacity-50" />
							<div className="text-base font-semibold text-(--theme-text-muted-color) mb-2">暂无数据</div>
							<div className="text-sm text-(--theme-text-muted-color)/70">所选节点暂无多样本延迟数据</div>
						</div>
					) : (
						(() => {
							const contentMinWidth = colCount > 0 ? colCount * minColumnWidth + (colCount - 1) * columnGapPx : 0
							return (
								<>
									{/* 单一滚动容器，横向和纵向滚动 */}
									<div className="flex-1 min-h-0 overflow-auto nice-scrollbar">
										<div className="flex gap-3 pb-2" style={{ minWidth: contentMinWidth }}>
											{/* 每一列作为独立的flex容器 */}
											{selectedCtxs.map((ctx, colIdx) => {
												const uuid = ctx.node.uuid
												const loading = allHistories[colIdx]?.loading || false
												const error = allHistories[colIdx]?.error || null
												const color = columnColors[colIdx % columnColors.length]

												return (
													<div key={uuid} className="flex-1" style={{ minWidth: minColumnWidth }}>
														{/* 整列容器 - 统一背景 */}
														<div className="rounded-xl bg-(--accent-a1)/50 p-3 border border-(--accent-a4) shadow-sm">
															{/* 列表头 - sticky */}
															<div className="sticky top-0 z-10 bg-(--accent-a2) backdrop-blur-md rounded-lg border border-(--accent-a4) p-3 mb-3 shadow-sm">
																{/* 节点信息 */}
																<div className="flex items-center gap-2 mb-2">
																	<div className="w-1 h-5 rounded-full shrink-0" style={{ backgroundColor: color }} />
																	<Flag flag={ctx.node.region} />
																	<div className="font-bold text-sm truncate flex-1">{ctx.node.name}</div>
																	<Button
																		variant="ghost"
																		size="icon"
																		className="h-6 w-6 shrink-0 hover:text-destructive"
																		onClick={() => removeSelected(uuid)}>
																		<X className="size-3.5" />
																	</Button>
																</div>

																{/* 排序按钮 */}
																<div className="flex items-center gap-2">
																	<Button
																		variant="ghost"
																		size="sm"
																		className={`h-6 px-2 text-[11px] ${sortBtnClass(uuid, 'default')}`}
																		onClick={() => toggleSort(uuid, 'default')}>
																		默认
																	</Button>
																	<Button
																		variant="ghost"
																		size="sm"
																		className={`h-6 px-2 text-[11px] ${sortBtnClass(uuid, 'name')}`}
																		onClick={() => toggleSort(uuid, 'name')}>
																		名称{sortBadge(uuid, 'name') ? sortBadge(uuid, 'name') : ''}
																	</Button>
																	<Button
																		variant="ghost"
																		size="sm"
																		className={`h-6 px-2 text-[11px] ${sortBtnClass(uuid, 'latency')}`}
																		onClick={() => toggleSort(uuid, 'latency')}>
																		延迟{sortBadge(uuid, 'latency') ? sortBadge(uuid, 'latency') : ''}
																	</Button>
																	<Button
																		variant="ghost"
																		size="sm"
																		className={`h-6 px-2 text-[11px] ${sortBtnClass(uuid, 'loss')}`}
																		onClick={() => toggleSort(uuid, 'loss')}>
																		丢包{sortBadge(uuid, 'loss') ? sortBadge(uuid, 'loss') : ''}
																	</Button>
																	<div className="ml-auto" />
																	{autoCompare && winStatsByCol[colIdx] && winStatsByCol[colIdx].total > 0 && (
																		<span className="text-[11px] font-semibold tabular-nums px-2 py-0.5 rounded-full border border-(--accent-a6) bg-(--accent-a4)/50 text-(--accent-11) shadow-sm">
																			{winStatsByCol[colIdx].totalCommon > 0
																				? winStatsByCol[colIdx].winsCommon
																				: winStatsByCol[colIdx].wins}
																			/
																			{winStatsByCol[colIdx].totalCommon > 0
																				? winStatsByCol[colIdx].totalCommon
																				: winStatsByCol[colIdx].total}
																		</span>
																	)}
																</div>

																{loading && <div className="text-[11px] text-(--theme-text-muted-color) mt-1.5">加载中…</div>}
																{error && <div className="text-[11px] text-destructive mt-1.5">错误：{error}</div>}
															</div>

															{/* 数据卡片列表 */}
															<div className="space-y-3">
																{compareGroups.map((group, groupIdx) => (
																	<div key={group.key}>
																		{groupIdx > 0 && <div className="h-px bg-(--accent-a5) my-3" />}
																		{group.rows.map(row => {
																			const cell = row.cells[colIdx]
																			if (!cell) {
																				return (
																					<div
																						key={`${row.key}:empty`}
																						style={{ minHeight: compareCardMinHeight, height: compareCardMinHeight }}
																						className="rounded-lg border border-dashed border-(--accent-a4) bg-(--accent-a2) flex items-center justify-center mb-3">
																						<span className="text-xs text-(--theme-text-muted-color)">—</span>
																					</div>
																				)
																			}

																			const lossRate = cell.summary?.lossRate ?? 0
																			const lossColor = getLossColor(lossRate)
																			const series = ctx.seriesByTaskId.get(cell.taskId) || []
																			const compareInfo = autoCompare ? taskCompareById.get(cell.taskId) : undefined
																			const isWinner = !!compareInfo && compareInfo.winnerColIdx === colIdx

																			return (
																				<div
																					key={`${row.key}:${cell.taskId}`}
																					style={{ minHeight: compareCardMinHeight, height: compareCardMinHeight }}
																					className="bg-(--accent-a2) backdrop-blur-sm rounded-lg p-3 border border-(--accent-a4) hover:border-(--accent-a6) hover:shadow-md transition-all mb-3 flex flex-col">
																					{/* 任务名称和丢包率 */}
																					<div className="flex items-start gap-2 mb-2">
																						<div className="flex-1 min-w-0">
																							<div className="font-semibold text-[13px] truncate leading-tight flex items-center gap-1.5">
																								<span className="truncate">{cell.taskName}</span>
																							</div>
																							<div className="text-[10px] text-(--theme-text-muted-color) mt-0.5">
																								ID {cell.taskId}
																							</div>
																						</div>
																						<div className="flex items-center gap-1 px-2 py-1 rounded-md bg-(--accent-a3)/40 border border-(--accent-a4)/60 shrink-0">
																							<span
																								className="w-2 h-2 rounded-full shadow-sm"
																								style={{ backgroundColor: lossColor }}
																							/>
																							<span className="text-[10px] font-semibold tabular-nums">
																								{lossRate.toFixed(2)}%
																							</span>
																							{isWinner && (
																								<Tips
																									side="top"
																									mode="popup"
																									contentMinWidth="min(60rem, 92vw)"
																									contentMaxWidth="92vw"
																									trigger={
																										<span className="inline-flex items-center justify-center text-[10px] font-bold leading-none px-1.5 py-0.5 rounded bg-amber-500/25 text-amber-950 border border-amber-600/30 dark:bg-amber-500/20 dark:text-amber-200 dark:border-amber-500/30">
																											胜
																										</span>
																									}>
																									<div className="space-y-2">
																										<div className="flex items-center justify-between gap-2">
																											<div className="text-xs font-semibold">
																												胜者原因
																											</div>
																											<span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border border-(--accent-a6) bg-(--accent-a4)/50 text-(--accent-11)">
																												总分越低越好
																											</span>
																										</div>
																										{(() => {
																											const winner =
																												compareInfo.breakdowns.find(
																													b => b.colIdx === compareInfo.winnerColIdx
																												) || null
																											const sorted = compareInfo.breakdowns
																												.slice()
																												.sort((a, b) => a.scoreMs - b.scoreMs)
																											const runnerUp =
																												sorted.find(
																													b => b.colIdx !== compareInfo.winnerColIdx
																												) || null
																											if (!winner) return null
																											return (
																												<div className="text-[11px] leading-relaxed">
																													<div className="font-medium">
																														胜者：{winner.nodeName}（
																														{Number.isFinite(winner.scoreMs)
																															? `${winner.scoreMs.toFixed(2)}ms`
																															: '—'}
																														）
																														{runnerUp
																															? `，对比：${
																																	runnerUp.nodeName
																															  }（${runnerUp.scoreMs.toFixed(
																																	2
																															  )}ms）`
																															: ''}
																													</div>
																												</div>
																											)
																										})()}
																										<div className="text-[11px] text-(--theme-text-muted-color) leading-relaxed">
																											<div>
																												总分 = 平均延迟 +{' '}
																												{compareInfo.params.stabilityWeight}×稳定性 +
																												丢包惩罚 + 小样本保守惩罚
																											</div>
																											<div>
																												稳定性 = max(抖动SD,
																												(范围)/2)；平滑丢包率使用经验贝叶斯收缩（先验强度{' '}
																												{compareInfo.params.priorStrength}）
																											</div>
																											<div>
																												有效丢包率 = 平滑丢包率 +{' '}
																												{compareInfo.params.lossNowWeight}×max(0,
																												recent-平滑) +{' '}
																												{compareInfo.params.lossPeakWeight}×max(0,
																												p95-平滑)；丢包扣分 ={' '}
																												{compareInfo.params.lossWeightPerPct}×有效丢包率
																											</div>
																											<div className="pt-1">
																												提示：对比表按总分从低到高排序，最低者为胜。
																											</div>
																										</div>
																										<div>
																											<div className="grid grid-cols-[minmax(12rem,1fr)_auto_auto_auto_auto_auto] gap-x-3 gap-y-1 text-[11px]">
																												<div className="text-(--theme-text-muted-color)">
																													节点
																												</div>
																												<div className="text-(--theme-text-muted-color) text-right">
																													丢包(原/平滑/有效)
																												</div>
																												<div className="text-(--theme-text-muted-color) text-right">
																													延迟均值
																												</div>
																												<div className="text-(--theme-text-muted-color) text-right">
																													稳定项
																												</div>
																												<div className="text-(--theme-text-muted-color) text-right">
																													丢包扣分
																												</div>
																												<div className="text-(--theme-text-muted-color) text-right">
																													总分（↓更好）
																												</div>
																												{compareInfo.breakdowns
																													.slice()
																													.sort((a, b) => a.scoreMs - b.scoreMs)
																													.map(bd => {
																														const active =
																															bd.colIdx ===
																															compareInfo.winnerColIdx
																														const lossRaw =
																															bd.totalCount > 0
																																? `${bd.lossRateRawPct.toFixed(
																																		2
																																  )}%`
																																: '—'
																														const lossSmooth = `${bd.lossSmoothedPct.toFixed(
																															2
																														)}%`
																														const lossEff = `${bd.lossEffectivePct.toFixed(
																															2
																														)}%`
																														const latency = Number.isFinite(
																															bd.latencyAvgMs
																														)
																															? `${bd.latencyAvgMs.toFixed(2)}ms`
																															: '—'
																														const stabilityTerm = Number.isFinite(
																															bd.stabilityPenaltyMs
																														)
																															? `${(
																																	compareInfo.params
																																		.stabilityWeight *
																																	bd.stabilityPenaltyMs
																															  ).toFixed(2)}ms`
																															: '—'
																														return (
																															<div
																																key={bd.uuid}
																																className={`contents ${
																																	active ? 'text-primary' : ''
																																}`}>
																																<div className="truncate font-medium">
																																	{bd.nodeName}
																																</div>
																																<div className="text-right tabular-nums">
																																	{lossRaw} / {lossSmooth} /{' '}
																																	{lossEff}{' '}
																																	<span className="text-(--theme-text-muted-color)">
																																		({bd.lossCount}/
																																		{bd.totalCount})
																																	</span>
																																	<span className="text-(--theme-text-muted-color)">
																																		{' '}
																																		recent/p95{' '}
																																		{Number.isFinite(
																																			bd.lossRecentPct
																																		)
																																			? bd.lossRecentPct.toFixed(
																																					0
																																			  )
																																			: '—'}
																																		%/
																																		{Number.isFinite(
																																			bd.lossPeakP95Pct
																																		)
																																			? bd.lossPeakP95Pct.toFixed(
																																					0
																																			  )
																																			: '—'}
																																		% （现
																																		{Number.isFinite(
																																			bd.lossNowPct
																																		)
																																			? bd.lossNowPct.toFixed(
																																					0
																																			  )
																																			: '—'}
																																		%/峰
																																		{Number.isFinite(
																																			bd.lossPeakMaxPct
																																		)
																																			? bd.lossPeakMaxPct.toFixed(
																																					0
																																			  )
																																			: '—'}
																																		%）
																																	</span>
																																</div>
																																<div className="text-right tabular-nums">
																																	{latency}
																																</div>
																																<div className="text-right tabular-nums">
																																	{stabilityTerm}
																																	<span className="text-(--theme-text-muted-color)">
																																		{' '}
																																		(SD{' '}
																																		{Number.isFinite(
																																			bd.jitterSdMs
																																		)
																																			? bd.jitterSdMs.toFixed(
																																					2
																																			  )
																																			: '—'}{' '}
																																		/ 范围{' '}
																																		{Number.isFinite(
																																			bd.latencyRangeMs
																																		)
																																			? bd.latencyRangeMs.toFixed(
																																					2
																																			  )
																																			: '—'}
																																		)
																																	</span>
																																</div>
																																<div className="text-right tabular-nums">
																																	{Number.isFinite(
																																		bd.lossPenaltyMs
																																	)
																																		? `${bd.lossPenaltyMs.toFixed(
																																				1
																																		  )}分`
																																		: '—'}
																																</div>
																																<div className="text-right tabular-nums font-semibold">
																																	{Number.isFinite(bd.scoreMs)
																																		? `${bd.scoreMs.toFixed(
																																				2
																																		  )}分`
																																		: '—'}
																																	<span className="text-(--theme-text-muted-color)">
																																		{' '}
																																		(保守{' '}
																																		{bd.uncertaintyPenaltyMs.toFixed(
																																			2
																																		)}
																																		)
																																	</span>
																																</div>
																															</div>
																														)
																													})}
																											</div>
																										</div>
																										<div className="text-[11px] text-(--theme-text-muted-color)">
																											本任务基线丢包率：
																											{compareInfo.breakdowns[0]?.lossBaselinePct?.toFixed(
																												3
																											)}
																											%
																										</div>
																									</div>
																								</Tips>
																							)}
																						</div>
																					</div>

																					{/* 延迟数据 - Tag样式 */}
																					<div className="flex flex-wrap gap-1.5 mb-2.5">
																						<div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-(--accent-a3)/40 border border-(--accent-a4)/50 text-[10px]">
																							<span className="text-(--theme-text-muted-color) text-[9px]">
																								当前
																							</span>
																							<span className="font-semibold tabular-nums">
																								{formatLatency(cell.summary?.medianNow, 2)}
																							</span>
																						</div>
																						<div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-(--accent-a3)/40 border border-(--accent-a4)/50 text-[10px]">
																							<span className="text-(--theme-text-muted-color) text-[9px]">
																								均值
																							</span>
																							<span className="font-semibold tabular-nums">
																								{formatLatency(cell.summary?.medianAvg, 2)}
																							</span>
																						</div>
																						<div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-(--accent-a3)/40 border border-(--accent-a4)/50 text-[10px]">
																							<span className="text-(--theme-text-muted-color) text-[9px]">
																								最小
																							</span>
																							<span className="font-semibold tabular-nums">
																								{formatLatency(cell.summary?.medianMin, 2)}
																							</span>
																						</div>
																						<div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-(--accent-a3)/40 border border-(--accent-a4)/50 text-[10px]">
																							<span className="text-(--theme-text-muted-color) text-[9px]">
																								最大
																							</span>
																							<span className="font-semibold tabular-nums">
																								{formatLatency(cell.summary?.medianMax, 2)}
																							</span>
																						</div>
																					</div>

																					{/* 图表 */}
																					<div className="flex-1 min-h-[100px] rounded-md border border-(--accent-a4)/50 bg-(--accent-a2)/20 p-2">
																					{series.length >= 2 ? (
																						<ResponsiveContainer width="100%" height="100%">
																								<ComposedChart
																									data={series}
																									margin={{ top: 2, right: 2, bottom: 0, left: 0 }}>
																									<XAxis
																										type="number"
																										dataKey="time"
																										domain={['dataMin', 'dataMax']}
																										hide
																										height={0}
																										tick={false}
																										axisLine={false}
																										tickLine={false}
																									/>
																									<YAxis
																										width={32}
																										tick={{ fontSize: 9, fill: 'var(--accent-a10)' }}
																										domain={['dataMin', 'dataMax']}
																										tickFormatter={v =>
																											v < 1
																												? `${(v * 1000).toFixed(0)}`
																												: `${v.toFixed(0)}`
																										}
																									/>
																									<Tooltip
																										cursor={{
																											stroke: 'var(--accent-a6)',
																											strokeOpacity: 0.4,
																											strokeWidth: 1.5,
																											strokeDasharray: '3 3'
																										}}
																										content={({ active, payload }) => {
																											if (!active || !payload?.length) return null
																											const p = payload[0].payload as SeriesPoint
																											return (
																												<div className="rounded-lg bg-background/98 backdrop-blur-md shadow-xl border-2 border-(--accent-a5) px-2.5 py-2 text-[10px]">
																													<div className="text-[9px] text-muted-foreground mb-1">
																														{new Date(p.time).toLocaleString(
																															'zh-CN',
																															{
																																month: '2-digit',
																																day: '2-digit',
																																hour: '2-digit',
																																minute: '2-digit'
																															}
																														)}
																													</div>
																													<div className="flex items-center gap-1 mb-1">
																														<span
																															className="w-1.5 h-1.5 rounded-sm"
																															style={{ backgroundColor: color }}
																														/>
																														<span className="font-semibold">
																															{cell.taskName}
																														</span>
																													</div>
																													<div className="space-y-0.5">
																														<div>
																															中位: {formatLatency(p.median, 2)}
																														</div>
																														<div className="text-muted-foreground">
																															丢包: {p.lossRate.toFixed(2)}%
																														</div>
																													</div>
																												</div>
																											)
																										}}
																									/>
																									<Area
																										type="monotone"
																										dataKey="p10"
																										stackId="base"
																										stroke="transparent"
																										fill="transparent"
																										isAnimationActive={false}
																										connectNulls
																									/>
																									<Area
																										type="monotone"
																										dataKey="band"
																										stackId="base"
																										stroke="none"
																										fill={color}
																										fillOpacity={0.15}
																										isAnimationActive={false}
																										connectNulls
																									/>
																									<Line
																										type="monotone"
																										dataKey="median"
																										stroke={color}
																										strokeWidth={1.8}
																											dot={(props: any) => {
																												const p = props?.payload as SeriesPoint | undefined
																												const key = `${props?.index ?? 'i'}-${p?.time ?? 't'}`
																												if (
																													!p ||
																													typeof p.lossRate !== 'number' ||
																													p.lossRate <= 0 ||
																													typeof props?.cx !== 'number' ||
																													typeof props?.cy !== 'number'
																												)
																													return <g key={key} />
																												const r = p.lossRate >= 20 ? 3 : 2.3
																												return (
																													<circle
																														key={key}
																														cx={props.cx}
																														cy={props.cy}
																														r={r}
																														fill={getLossColor(p.lossRate)}
																														stroke="var(--background)"
																														strokeWidth={0.6}
																													/>
																												)
																											}}
																										isAnimationActive={false}
																										connectNulls
																									/>
																								</ComposedChart>
																							</ResponsiveContainer>
																						) : (
																							<div className="h-full flex items-center justify-center text-[10px] text-(--theme-text-muted-color)">
																								数据不足
																							</div>
																						)}
																					</div>
																				</div>
																			)
																		})}
																	</div>
																))}
															</div>
														</div>
													</div>
												)
											})}
										</div>
									</div>
								</>
							)
						})()
					)}
				</Card>
			</div>
		</div>
	)
}

export default LatencyCompare
