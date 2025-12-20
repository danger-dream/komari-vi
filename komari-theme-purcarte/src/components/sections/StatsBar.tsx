import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Settings2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { formatBytes } from '@/utils'
import { useIsMobile } from '@/hooks/useMobile'
import type { NodeWithStatus } from '@/types/node'
import { useAppConfig } from '@/config'
import { useExchangeRate } from '@/contexts/ExchangeRateContext'
import { formatCurrency } from '@/utils/formatHelper'
import Tips from '@/components/ui/tips'

interface StatsBarProps {
	displayOptions: {
		currentTime: boolean
		currentOnline: boolean
		regionOverview: boolean
		trafficOverview: boolean
		networkSpeed: boolean
		monthlySummary?: boolean
		yearlySummary?: boolean
	}
	setDisplayOptions: (options: any) => void
	stats: {
		onlineCount: number
		totalCount: number
		uniqueRegions: number
		totalTrafficUp: number
		totalTrafficDown: number
		currentSpeedUp: number
		currentSpeedDown: number
	}
	loading: boolean
	nodes: NodeWithStatus[]
	billing: {
		monthlyTotal: number
		monthlyRemaining: number
		nodesSumPrice: number
		nodesRemainingYear: number
		monthlyPerNode: { name: string; amount: number }[]
		nodesPriceList: { name: string; amount: number }[]
		monthlyEvents: { name: string; date: Date; amount: number }[]
		yearPerNode: { name: string; amount: number }[]
	}
}

export const StatsBar = ({ displayOptions, setDisplayOptions, stats, loading, billing }: StatsBarProps) => {
	const isMobile = useIsMobile()
	const [time, setTime] = useState(new Date())
	const [monthlyExpanded, setMonthlyExpanded] = useState(false)
	const [yearlyExpanded, setYearlyExpanded] = useState(false)
	const { enableMonthlyRenewalCalculation } = useAppConfig()
	const { currentCurrency, getCurrencySymbol } = useExchangeRate()

	useEffect(() => {
		const timer = setInterval(() => {
			setTime(new Date())
		}, 1000)
		return () => clearInterval(timer)
	}, [])

	// 获取已启用的统计项列表（含默认开启开关）
	const effectiveDisplay = {
		...displayOptions,
		monthlySummary: displayOptions.monthlySummary ?? true,
		yearlySummary: displayOptions.yearlySummary ?? true
	}
	const enabledStats = Object.keys(effectiveDisplay).filter(key => effectiveDisplay[key as keyof typeof effectiveDisplay])

	const currencySymbol = getCurrencySymbol(currentCurrency)
	const formatAmount = (amount: number) => formatCurrency(amount, currencySymbol, { showSymbol: true, decimalPlaces: 2 })
	const formatMonthDay = (d: Date) => `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

	// 渲染统计项
	const renderStatItem = (key: string) => {
		switch (key) {
			case 'currentTime':
				return (
					displayOptions.currentTime && (
						<div className="w-full py-1" key="currentTime">
							<div className="flex flex-col gap-2">
								<label className="text-secondary-foreground text-sm">当前时间</label>
								<label className="font-medium -mt-2 text-md">{time.toLocaleTimeString()}</label>
							</div>
						</div>
					)
				)
			case 'currentOnline':
				return (
					displayOptions.currentOnline && (
						<div className="w-full py-1" key="currentOnline">
							<div className="flex flex-col gap-2">
								<label className="text-secondary-foreground text-sm">当前在线</label>
								<label className="font-medium -mt-2 text-md">{loading ? '...' : `${stats.onlineCount} / ${stats.totalCount}`}</label>
							</div>
						</div>
					)
				)
			case 'regionOverview':
				return (
					displayOptions.regionOverview && (
						<div className="w-full py-1" key="regionOverview">
							<div className="flex flex-col gap-2">
								<label className="text-secondary-foreground text-sm">点亮地区</label>
								<label className="font-medium -mt-2 text-md">{loading ? '...' : stats.uniqueRegions}</label>
							</div>
						</div>
					)
				)
			case 'trafficOverview':
				return (
					displayOptions.trafficOverview && (
						<div className="w-full py-1" key="trafficOverview">
							<div className="flex flex-col gap-2">
								<label className="text-secondary-foreground text-sm">流量概览</label>
								<div className="font-medium -mt-2 text-md">
									{loading ? (
										'...'
									) : (
										<div className="flex flex-col items-center">
											<span>{`↑ ${formatBytes(stats.totalTrafficUp)}`}</span>
											<span>{`↓ ${formatBytes(stats.totalTrafficDown)}`}</span>
										</div>
									)}
								</div>
							</div>
						</div>
					)
				)
			case 'networkSpeed':
				return (
					displayOptions.networkSpeed && (
						<div className="w-full py-1" key="networkSpeed">
							<div className="flex flex-col gap-2">
								<label className="text-secondary-foreground text-sm">网络速率</label>
								<div className="font-medium -mt-2 text-md">
									{loading ? (
										'...'
									) : (
										<div className="flex flex-col items-center">
											<span>{`↑ ${formatBytes(stats.currentSpeedUp)}/s`}</span>
											<span>{`↓ ${formatBytes(stats.currentSpeedDown)}/s`}</span>
										</div>
									)}
								</div>
							</div>
						</div>
					)
				)
			case 'monthlySummary':
				if (!enableMonthlyRenewalCalculation) return null
				const monthlyPerNode = monthlyExpanded ? billing.monthlyPerNode : billing.monthlyPerNode.slice(0, 10)
				const monthlyEvents = monthlyExpanded ? billing.monthlyEvents : billing.monthlyEvents.slice(0, 10)
				return (
					<div className="w-full py-1" key="monthlySummary">
						<div className="flex flex-col gap-2">
							<div className="flex items-center justify-center gap-2">
								<label className="text-secondary-foreground text-sm">月付金额</label>
								<Tips side="top" contentMinWidth="22rem" contentMaxWidth="26rem">
									<div className="space-y-2">
										<div className="flex items-center justify-between">
											<div className="font-medium">按节点折算月费{monthlyExpanded ? '' : '（前10）'}</div>
											<Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setMonthlyExpanded(v => !v)}>
												{monthlyExpanded ? '收起' : '展开更多'}
											</Button>
										</div>
										<div className="space-y-1 max-h-64 overflow-y-auto pr-1 nice-scrollbar">
											{monthlyPerNode.map(item => (
												<div key={item.name} className="flex items-center justify-between gap-3">
													<span className="truncate max-w-[14rem] min-w-0" title={item.name}>{item.name}</span>
													<span className="text-right whitespace-nowrap shrink-0">{formatAmount(item.amount)}</span>
												</div>
											))}
										</div>
										<div className="font-medium pt-2">本月剩余续费事件{monthlyExpanded ? '' : '（前10）'}</div>
										<div className="space-y-1 max-h-64 overflow-y-auto pr-1 nice-scrollbar">
											{monthlyEvents.map((evt, idx) => (
												<div key={`${evt.name}-${idx}`} className="flex items-center justify-between gap-3">
													<span className="truncate max-w-[14rem] min-w-0" title={evt.name}>{evt.name}</span>
													<div className="flex items-baseline gap-2 shrink-0">
														<span className="opacity-80 text-xs whitespace-nowrap w-12 text-right">{formatMonthDay(evt.date)}</span>
														<span className="text-right whitespace-nowrap">{formatAmount(evt.amount)}</span>
													</div>
												</div>
											))}
										</div>
									</div>
								</Tips>
							</div>
							<div className="font-medium -mt-2 text-md flex flex-col items-center">
								<span>{formatAmount(billing.monthlyTotal)}</span>
								<span className="text-xs opacity-80">当月剩余应付：{formatAmount(billing.monthlyRemaining)}</span>
							</div>
						</div>
					</div>
				)
			case 'yearlySummary':
				if (!enableMonthlyRenewalCalculation) return null
				const yearlyPriceList = yearlyExpanded ? billing.nodesPriceList : billing.nodesPriceList.slice(0, 10)
				const yearlyPerNode = yearlyExpanded ? billing.yearPerNode : billing.yearPerNode.slice(0, 10)
				return (
					<div className="w-full py-1" key="yearlySummary">
						<div className="flex flex-col gap-2">
							<div className="flex items-center justify-center gap-2">
								<label className="text-secondary-foreground text-sm">总金额</label>
								<Tips side="top" contentMinWidth="22rem" contentMaxWidth="26rem">
									<div className="space-y-2">
										<div className="flex items-center justify-between">
											<div className="font-medium">节点标价{yearlyExpanded ? '' : '（前10）'}</div>
											<Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setYearlyExpanded(v => !v)}>
												{yearlyExpanded ? '收起' : '展开更多'}
											</Button>
										</div>
										<div className="space-y-1 max-h-64 overflow-y-auto pr-1 nice-scrollbar">
											{yearlyPriceList.map(item => (
												<div key={item.name} className="flex items-center justify-between gap-3">
													<span className="truncate max-w-[14rem] min-w-0" title={item.name}>{item.name}</span>
													<span className="text-right whitespace-nowrap shrink-0">{formatAmount(item.amount)}</span>
												</div>
											))}
										</div>
										<div className="font-medium pt-2">年内剩余应付{yearlyExpanded ? '' : '（前10）'}</div>
										<div className="space-y-1 max-h-64 overflow-y-auto pr-1 nice-scrollbar">
											{yearlyPerNode.map(item => (
												<div key={item.name} className="flex items-center justify-between gap-3">
													<span className="truncate max-w-[14rem] min-w-0" title={item.name}>{item.name}</span>
													<span className="text-right whitespace-nowrap shrink-0">{formatAmount(item.amount)}</span>
												</div>
											))}
										</div>
									</div>
								</Tips>
							</div>
							<div className="font-medium -mt-2 text-md flex flex-col items-center">
								<span>{formatAmount(billing.nodesSumPrice)}</span>
								<span className="text-xs opacity-80">年内剩余应付：{formatAmount(billing.nodesRemainingYear)}</span>
							</div>
						</div>
					</div>
				)
			default:
				return null
		}
	}

	return (
		<div className="purcarte-blur min-w-[300px] text-secondary-foreground my-4 mx-4 px-4 theme-card-style text-sm relative flex items-center min-h-[5rem]">
			<div className="absolute top-2 right-2">
				<DropdownMenu modal={false}>
					<DropdownMenuTrigger asChild>
						<Button variant="ghost" size="icon" className="cursor-pointer">
							<Settings2 />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						<DropdownMenuLabel>状态显示设置</DropdownMenuLabel>
						<DropdownMenuSeparator />
						<DropdownMenuItem className="flex items-center justify-between cursor-pointer">
							<span>当前时间</span>
							<Switch
								checked={displayOptions.currentTime}
								onCheckedChange={checked =>
									setDisplayOptions({
										...displayOptions,
										currentTime: checked
									})
								}
							/>
						</DropdownMenuItem>
						<DropdownMenuItem className="flex items-center justify-between cursor-pointer">
							<span>当前在线</span>
							<Switch
								checked={displayOptions.currentOnline}
								onCheckedChange={checked =>
									setDisplayOptions({
										...displayOptions,
										currentOnline: checked
									})
								}
							/>
						</DropdownMenuItem>
						<DropdownMenuItem className="flex items-center justify-between cursor-pointer">
							<span>点亮地区</span>
							<Switch
								checked={displayOptions.regionOverview}
								onCheckedChange={checked =>
									setDisplayOptions({
										...displayOptions,
										regionOverview: checked
									})
								}
							/>
						</DropdownMenuItem>
						<DropdownMenuItem className="flex items-center justify-between cursor-pointer">
							<span>流量概览</span>
							<Switch
								checked={displayOptions.trafficOverview}
								onCheckedChange={checked =>
									setDisplayOptions({
										...displayOptions,
										trafficOverview: checked
									})
								}
							/>
						</DropdownMenuItem>
						<DropdownMenuItem className="flex items-center justify-between cursor-pointer">
							<span>网络速率</span>
							<Switch
								checked={displayOptions.networkSpeed}
								onCheckedChange={checked =>
									setDisplayOptions({
										...displayOptions,
										networkSpeed: checked
									})
								}
							/>
						</DropdownMenuItem>
						<DropdownMenuItem className="flex items-center justify-between cursor-pointer">
							<span>月付金额</span>
							<Switch
								checked={effectiveDisplay.monthlySummary}
								onCheckedChange={checked =>
									setDisplayOptions({
										...displayOptions,
										monthlySummary: checked
									})
								}
							/>
						</DropdownMenuItem>
						<DropdownMenuItem className="flex items-center justify-between cursor-pointer">
							<span>总金额</span>
							<Switch
								checked={effectiveDisplay.yearlySummary}
								onCheckedChange={checked =>
									setDisplayOptions({
										...displayOptions,
										yearlySummary: checked
									})
								}
							/>
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
			<div
				className="grid w-full gap-2 text-center items-center py-3"
				style={{
					gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fit, minmax(180px, 1fr))',
					gridAutoRows: 'min-content'
				}}>
				{enabledStats.map(key => renderStatItem(key))}
			</div>
		</div>
	)
}
