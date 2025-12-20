import { useState, useMemo, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { StatsBar } from '@/components/sections/StatsBar'
import { NodeCard } from '@/components/sections/NodeCard'
import { NodeListHeader } from '@/components/sections/NodeListHeader'
import { NodeListItem } from '@/components/sections/NodeListItem'
import Loading from '@/components/loading'
import type { NodeWithStatus } from '@/types/node'
import { useNodeData } from '@/contexts/NodeDataContext'
import { useLiveData } from '@/contexts/LiveDataContext'
import { useAppConfig } from '@/config'
import { useTheme } from '@/hooks/useTheme'
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import {
	Cpu,
	HardDrive,
	Activity,
	ArrowUpDown,
	Upload,
	Download,
	Radio,
	BarChart3,
	Timer,
	CalendarClock,
	Wallet,
	Clock3,
	Globe2,
	ChevronDown,
	Layers
} from 'lucide-react'
import { useExchangeRate } from '@/contexts/ExchangeRateContext'
import Flag from '@/components/sections/Flag'
import { sortByRegionPriority } from '@/utils/regionHelper'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	DropdownMenuSeparator,
	DropdownMenuLabel
} from '@/components/ui/dropdown-menu'

interface HomePageProps {
	searchTerm: string
	setSearchTerm: (term: string) => void
}

const homeStateCache = {
	selectedGroup: '所有',
	selectedRegion: '所有',
	scrollPosition: 0
}

const HomePage: React.FC<HomePageProps> = ({ searchTerm, setSearchTerm }) => {
	const { viewMode, statusCardsVisibility, setStatusCardsVisibility } = useTheme()
	const { nodes: staticNodes, loading, getGroups } = useNodeData()
	const { liveData } = useLiveData()
	const [selectedGroup, setSelectedGroup] = useState(homeStateCache.selectedGroup)
	const [selectedRegion, setSelectedRegion] = useState(homeStateCache.selectedRegion)
	const [sortKey, setSortKey] = useState<
		| 'default'
		| 'hardware_cpu'
		| 'hardware_mem'
		| 'hardware_disk'
		| 'usage_cpu'
		| 'usage_ram'
		| 'usage_disk'
		| 'network_up'
		| 'network_down'
		| 'traffic'
		| 'load'
		| 'uptime'
		| 'expiry'
		| 'price'
		| 'remain'
		| 'region'
	>('default')
	const [sortOrder, setSortOrder] = useState<'none' | 'asc' | 'desc'>('none')
	const { enableGroupedBar, enableStatsBar, enableSwap, enableListItemProgressBar, selectTrafficProgressStyle } = useAppConfig()
	const { convertCurrency, calculateMonthlyRenewalWithConversion } = useExchangeRate()
	const combinedNodes = useMemo<NodeWithStatus[]>(() => {
		if (!staticNodes || staticNodes === 'private') return []
		return staticNodes.map(node => {
			const isOnline = liveData?.online.includes(node.uuid) ?? false
			const stats = isOnline ? liveData?.data[node.uuid] : undefined

			return {
				...node,
				status: isOnline ? 'online' : 'offline',
				stats: stats
			}
		})
	}, [staticNodes, liveData])

	const groups = useMemo(() => ['所有', ...getGroups()], [getGroups])

	const normalizeRegion = (region: string) => (region || '').trim() || '未知'

	const regions = useMemo(() => {
		const base = combinedNodes.filter((node: NodeWithStatus) => selectedGroup === '所有' || node.group === selectedGroup)
		const list = Array.from(new Set(base.map(n => normalizeRegion(n.region)).filter(Boolean)))
		// 按地域优先级排序（中、港、台、新、马、日、美、欧优先）
		list.sort(sortByRegionPriority)
		return ['所有', ...list]
	}, [combinedNodes, selectedGroup])

	const filteredNodes = useMemo(() => {
		return combinedNodes
			.filter((node: NodeWithStatus) => selectedGroup === '所有' || node.group === selectedGroup)
			.filter((node: NodeWithStatus) => selectedRegion === '所有' || normalizeRegion(node.region) === selectedRegion)
			.filter((node: NodeWithStatus) => node.name.toLowerCase().includes(searchTerm.toLowerCase()))
	}, [combinedNodes, selectedGroup, selectedRegion, searchTerm])

	const sortedNodes = useMemo(() => {
		if (sortKey === 'default' || sortOrder === 'none') return filteredNodes
		const now = Date.now()
		const withIndex = filteredNodes.map((n, idx) => ({ node: n, idx }))

		const metric = (n: NodeWithStatus) => {
			const stats = n.stats
			switch (sortKey) {
				case 'hardware_cpu':
					return n.cpu_cores ?? 0
				case 'hardware_mem':
					return n.mem_total ?? 0
				case 'hardware_disk':
					return n.disk_total ?? 0
				case 'usage_cpu':
					return stats?.cpu.usage ?? 0
				case 'usage_ram':
					return stats?.ram.total ? stats.ram.used / stats.ram.total : 0
				case 'usage_disk':
					return stats?.disk.total ? stats.disk.used / stats.disk.total : 0
				case 'network_up':
					return stats?.network.up ?? 0
				case 'network_down':
					return stats?.network.down ?? 0
				case 'traffic':
					return (stats?.network.totalUp ?? 0) + (stats?.network.totalDown ?? 0)
				case 'load':
					return stats?.load.load1 ?? 0
				case 'uptime':
					return stats?.uptime ?? 0
				case 'expiry': {
					if (!n.expired_at) return Number.POSITIVE_INFINITY
					const t = new Date(n.expired_at).getTime()
					return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t
				}
				case 'price':
					return convertCurrency(n.price || 0, n.currency)
				case 'remain': {
					if (!n.expired_at) return Number.POSITIVE_INFINITY
					const t = new Date(n.expired_at).getTime()
					return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t - now
				}
				case 'region':
					return n.region || ''
				default:
					return 0
			}
		}

		const compareVal = (a: any, b: any) => {
			if (Array.isArray(a) && Array.isArray(b)) {
				const len = Math.min(a.length, b.length)
				for (let i = 0; i < len; i++) {
					if (a[i] === b[i]) continue
					return a[i] < b[i] ? -1 : 1
				}
				return 0
			}
			if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b, 'zh-CN')
			return a === b ? 0 : a < b ? -1 : 1
		}

		const sorted = [...withIndex].sort((a, b) => {
			const va = metric(a.node)
			const vb = metric(b.node)
			const cmp = compareVal(va, vb)
			if (cmp !== 0) return sortOrder === 'asc' ? cmp : -cmp
			return a.idx - b.idx
		})
		return sorted.map(item => item.node)
	}, [filteredNodes, sortKey, sortOrder, convertCurrency])

	const stats = useMemo(() => {
		return {
			onlineCount: filteredNodes.filter(n => n.status === 'online').length,
			totalCount: filteredNodes.length,
			uniqueRegions: new Set(filteredNodes.map(n => n.region)).size,
			totalTrafficUp: filteredNodes.reduce((acc, node) => acc + (node.stats?.network.totalUp || 0), 0),
			totalTrafficDown: filteredNodes.reduce((acc, node) => acc + (node.stats?.network.totalDown || 0), 0),
			currentSpeedUp: filteredNodes.reduce((acc, node) => acc + (node.stats?.network.up || 0), 0),
			currentSpeedDown: filteredNodes.reduce((acc, node) => acc + (node.stats?.network.down || 0), 0)
		}
	}, [filteredNodes])

	// 金额/账单统计（保持在 Home 侧 useMemo 计算）
	const billing = useMemo(() => {
		if (!filteredNodes || filteredNodes.length === 0) {
			return {
				monthlyTotal: 0,
				monthlyRemaining: 0,
				nodesSumPrice: 0,
				nodesRemainingYear: 0,
				monthlyPerNode: [] as { name: string; amount: number }[],
				nodesPriceList: [] as { name: string; amount: number }[],
				monthlyEvents: [] as { name: string; date: Date; amount: number }[],
				yearPerNode: [] as { name: string; amount: number }[]
			}
		}

		const now = new Date()
		const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
		const endOfYear = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999)

		// 辅助：在区间内累计续费，并返回事件明细
		const buildRenewalSummary = (start: Date, end: Date) => {
			const startMs = start.getTime()
			const endMs = end.getTime()
			let total = 0
			const events: { name: string; date: Date; amount: number }[] = []
			for (const n of filteredNodes) {
				const { price, billing_cycle, currency, expired_at, name } = n
				if (!price || price <= 0) continue
				if (!billing_cycle || billing_cycle <= 0) continue
				if (!expired_at) continue
				const base = new Date(expired_at)
				let baseMs = base.getTime()
				const periodMs = billing_cycle * 24 * 60 * 60 * 1000
				if (Number.isNaN(baseMs) || !Number.isFinite(periodMs) || periodMs <= 0) continue
				if (baseMs < startMs) {
					const k = Math.floor((startMs - baseMs) / periodMs) + 1
					baseMs = baseMs + k * periodMs
				}
				for (let t = baseMs; t <= endMs; t += periodMs) {
					const converted = convertCurrency(price, currency)
					total += converted
					events.push({ name, date: new Date(t), amount: converted })
				}
			}
			events.sort((a, b) => a.date.getTime() - b.date.getTime())
			return { total, events }
		}

		// 1) 月付金额 第一行：节点折算为30天合计
		const monthlyTotal = filteredNodes.reduce((acc, n) => acc + calculateMonthlyRenewalWithConversion(n.price, n.currency, n.billing_cycle), 0)

		// 1) 月付金额 第二行：本月区间续费
		const { total: monthlyRemaining, events: monthlyEvents } = buildRenewalSummary(now, endOfMonth)

		// 2) 节点总金额 第一行：节点标价按当前货币合计
		const nodesSumPrice = filteredNodes.reduce((acc, n) => (n.price && n.price > 0 ? acc + convertCurrency(n.price, n.currency) : acc), 0)

		// 2) 节点总金额 第二行：年内区间续费（聚合）
		const { total: nodesRemainingYear, events: yearEvents } = buildRenewalSummary(now, endOfYear)
		const yearAggMap = yearEvents.reduce<Record<string, { name: string; amount: number }>>((acc, evt) => {
			acc[evt.name] = acc[evt.name] ? { name: evt.name, amount: acc[evt.name].amount + evt.amount } : { name: evt.name, amount: evt.amount }
			return acc
		}, {})
		const yearPerNode = Object.values(yearAggMap).sort((a, b) => b.amount - a.amount)

		// 明细：按节点月费、节点标价
		const monthlyPerNode = filteredNodes
			.map(n => ({ name: n.name, amount: calculateMonthlyRenewalWithConversion(n.price, n.currency, n.billing_cycle) }))
			.sort((a, b) => b.amount - a.amount)
		const nodesPriceList = filteredNodes
			.filter(n => n.price && n.price > 0)
			.map(n => ({ name: n.name, amount: convertCurrency(n.price, n.currency) }))
			.sort((a, b) => b.amount - a.amount)

		return {
			monthlyTotal,
			monthlyRemaining,
			nodesSumPrice,
			nodesRemainingYear,
			monthlyPerNode,
			nodesPriceList,
			monthlyEvents,
			yearPerNode
		}
	}, [filteredNodes, convertCurrency, calculateMonthlyRenewalWithConversion])

	const mainContentRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		const handleScroll = () => {
			if (mainContentRef.current) {
				homeStateCache.scrollPosition = mainContentRef.current.scrollTop
			}
		}

		const mainContentElement = mainContentRef.current
		mainContentElement?.addEventListener('scroll', handleScroll)

		return () => {
			mainContentElement?.removeEventListener('scroll', handleScroll)
		}
	}, [])

	useEffect(() => {
		if (mainContentRef.current) {
			mainContentRef.current.scrollTop = homeStateCache.scrollPosition
		}
	}, [loading])

	useEffect(() => {
		homeStateCache.selectedGroup = selectedGroup
	}, [selectedGroup])

	useEffect(() => {
		homeStateCache.selectedRegion = selectedRegion
	}, [selectedRegion])

	useEffect(() => {
		if (!regions.includes(selectedRegion)) {
			setSelectedRegion('所有')
		}
	}, [regions, selectedRegion])

	const sortOptions: { title: string; items: { key: typeof sortKey; label: string; icon: React.ComponentType<any> }[] }[] = [
		{
			title: '默认/地域',
			items: [
				{ key: 'default', label: '默认排序', icon: ArrowUpDown },
				{ key: 'region', label: '地域', icon: Globe2 }
			]
		},
		{
			title: '硬件性能',
			items: [
				{ key: 'hardware_cpu', label: 'CPU 核心', icon: Cpu },
				{ key: 'hardware_mem', label: '内存大小', icon: BarChart3 },
				{ key: 'hardware_disk', label: '硬盘大小', icon: HardDrive }
			]
		},
		{
			title: '资源占用',
			items: [
				{ key: 'usage_cpu', label: 'CPU 占用', icon: Activity },
				{ key: 'usage_ram', label: '内存占用', icon: BarChart3 },
				{ key: 'usage_disk', label: '硬盘占用', icon: HardDrive }
			]
		},
		{
			title: '网络情况',
			items: [
				{ key: 'network_up', label: '上传速率', icon: Upload },
				{ key: 'network_down', label: '下载速率', icon: Download },
				{ key: 'traffic', label: '流量使用量', icon: Radio }
			]
		},
		{
			title: '运行状态',
			items: [
				{ key: 'load', label: '负载情况', icon: BarChart3 },
				{ key: 'uptime', label: '在线时长', icon: Timer }
			]
		},
		{
			title: '账期与价格',
			items: [
				{ key: 'expiry', label: '到期时间', icon: CalendarClock },
				{ key: 'remain', label: '剩余时间', icon: Clock3 },
				{ key: 'price', label: '价格', icon: Wallet }
			]
		},
	]

	const toggleSort = (key: typeof sortKey) => {
		if (key !== sortKey) {
			setSortKey(key)
			setSortOrder(key === 'default' ? 'none' : 'desc')
			return
		}
		setSortOrder(prev => {
			if (prev === 'none') return 'desc'
			if (prev === 'desc') return 'asc'
			return 'none'
		})
	}

	const currentSortLabel = useMemo(() => {
		if (sortKey === 'default' || sortOrder === 'none') return '默认排序'
		const allItems = sortOptions.flatMap(g => g.items)
		const item = allItems.find(i => i.key === sortKey)
		return item ? `${item.label} ${sortOrder === 'asc' ? '↑' : '↓'}` : '默认排序'
	}, [sortKey, sortOrder])

	return (
		<div ref={mainContentRef} className="w-[90%] max-w-screen-2xl mx-auto flex-1 flex flex-col pb-10 overflow-y-auto">
			{enableStatsBar && (
				<StatsBar
					displayOptions={statusCardsVisibility}
					setDisplayOptions={setStatusCardsVisibility}
					stats={stats}
					loading={loading}
					nodes={filteredNodes}
					billing={billing}
				/>
			)}

			<main className="flex-1 px-4 pb-4">
				{enableGroupedBar && (
					<div className="purcarte-blur theme-card-style px-3 py-2 text-secondary-foreground">
						<div className="flex items-center gap-2">
							{/* 分组按钮 */}
							<div className="flex items-center gap-1 shrink-0">
								<Layers className="size-3.5 opacity-60" />
								<div className="flex items-center gap-1">
									{groups.map((group: string) => {
										const active = selectedGroup === group
										return (
											<button
												key={group}
												onClick={() => setSelectedGroup(group)}
												className={`h-7 px-2.5 text-xs rounded-full border transition-all whitespace-nowrap ${
													active
														? 'bg-(--accent-a7)/70 border-(--accent-a9)'
														: 'border-(--accent-a6)/60 hover:bg-(--accent-a5)/50'
												}`}
											>
												{group}
											</button>
										)
									})}
								</div>
							</div>

							{/* 分隔线 */}
							<div className="h-5 w-px bg-(--accent-a5)/40 shrink-0" />

							{/* 地域筛选 - 国旗图标，带滚动 */}
							<div className="flex items-center gap-1 min-w-0 flex-1 overflow-hidden">
								<Globe2 className="size-3.5 opacity-60 shrink-0" />
								<div className="flex items-center gap-1 overflow-x-auto nice-scrollbar">
									{regions.map(region => {
										const active = selectedRegion === region
										const isAll = region === '所有'
										return (
											<button
												key={region}
												onClick={() => setSelectedRegion(region)}
												title={region}
												className={`shrink-0 transition-all ${
													isAll
														? `h-7 px-2.5 text-xs rounded-full border ${active ? 'bg-(--accent-a7)/70 border-(--accent-a9)' : 'border-(--accent-a6)/60 hover:bg-(--accent-a5)/50'}`
														: `px-1 pb-0.5 border-b-2 ${active ? 'border-(--accent-9)' : 'border-transparent opacity-60 hover:opacity-100'}`
												}`}
											>
												{isAll ? '全部' : <Flag flag={region} />}
											</button>
										)
									})}
								</div>
							</div>

							{/* 分隔线 */}
							<div className="h-5 w-px bg-(--accent-a5)/40 shrink-0 ml-auto" />

							{/* 排序下拉 */}
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button variant="ghost" size="sm" className="h-8 px-3 gap-1.5 rounded-full border border-(--accent-a6)/60 bg-(--accent-a4)/35 hover:bg-(--accent-a5)/50 shrink-0">
										<ArrowUpDown className="size-3.5 opacity-70" />
										<span className="text-xs whitespace-nowrap">{currentSortLabel}</span>
										<ChevronDown className="size-3 opacity-60" />
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end" className="min-w-[160px] max-h-[60vh] overflow-y-auto nice-scrollbar">
									<DropdownMenuLabel className="text-xs opacity-70">排序方式</DropdownMenuLabel>
									<DropdownMenuSeparator />
									{sortOptions.map((group, groupIndex) => (
										<div key={group.title}>
											{groupIndex > 0 && <DropdownMenuSeparator />}
											<DropdownMenuLabel className="text-[10px] opacity-50 py-1">{group.title}</DropdownMenuLabel>
											{group.items.map(opt => {
												const isActive = sortKey === opt.key && sortOrder !== 'none'
												return (
													<DropdownMenuItem
														key={opt.key}
														onClick={() => toggleSort(opt.key)}
														className="text-xs cursor-pointer gap-2"
													>
														<opt.icon className="size-3.5 opacity-70" />
														<span className="flex-1">{opt.label}</span>
														{isActive && (
															<span className="text-[10px] opacity-80">{sortOrder === 'asc' ? '↑' : '↓'}</span>
														)}
													</DropdownMenuItem>
												)
											})}
										</div>
									))}
								</DropdownMenuContent>
							</DropdownMenu>
						</div>
					</div>
				)}

				<div className="space-y-4 mt-4">
					{loading ? (
						<Loading text="正在努力获取数据中..." />
					) : filteredNodes.length > 0 ? (
						<div className={viewMode === 'grid' ? '' : 'space-y-2 overflow-auto purcarte-blur theme-card-style p-2'}>
							<div className={viewMode === 'grid' ? 'grid grid-cols-[repeat(auto-fill,minmax(330px,1fr))] gap-4' : 'min-w-[1080px]'}>
								{viewMode === 'table' && <NodeListHeader enableSwap={enableSwap} />}
								{sortedNodes.map((node: NodeWithStatus) =>
									viewMode === 'grid' ? (
										<NodeCard key={node.uuid} node={node} enableSwap={enableSwap} selectTrafficProgressStyle={selectTrafficProgressStyle} />
									) : (
										<NodeListItem
											key={node.uuid}
											node={node}
											enableSwap={enableSwap}
											enableListItemProgressBar={enableListItemProgressBar}
											selectTrafficProgressStyle={selectTrafficProgressStyle}
										/>
									)
								)}
							</div>
						</div>
					) : (
						<div className="flex flex-grow items-center justify-center">
							<Card className="w-full max-w-md">
								<CardHeader>
									<CardTitle className="text-2xl font-bold">Not Found</CardTitle>
									<CardDescription>请尝试更改筛选条件</CardDescription>
								</CardHeader>
								<CardFooter>
									<Button onClick={() => setSearchTerm('')} className="w-full">
										清空搜索
									</Button>
								</CardFooter>
							</Card>
						</div>
					)}
				</div>
			</main>
		</div>
	)
}

export default HomePage
