import React from 'react'
import { useExchangeRate } from '@/contexts/ExchangeRateContext'
import { Button } from './button'
import { Input } from './input'
import { Copy, Check, X } from 'lucide-react'

interface RemainingValuePanelProps {
	price: number
	currency: string
	billingCycle: number
	expiredAt: string | null
	transactionDate?: string | null
}

const mapCycleToDays = (billingCycle: number) => {
	if (billingCycle >= 28 && billingCycle <= 31) return { days: 30, label: '月付', unit: '月' }
	if (billingCycle >= 89 && billingCycle <= 92) return { days: 90, label: '季付', unit: '季' }
	if (billingCycle >= 180 && billingCycle <= 184) return { days: 180, label: '半年付', unit: '半年' }
	if (billingCycle >= 364 && billingCycle <= 366) return { days: 365, label: '年付', unit: '年' }
	return { days: Math.max(1, billingCycle), label: `${billingCycle}天`, unit: `${billingCycle}天` }
}

export const RemainingValuePanel: React.FC<RemainingValuePanelProps> = ({ price, currency, billingCycle, expiredAt }) => {
	const { formatCurrencyWithConversion, formatPriceWithConversion, convertCurrency, currentCurrency, currencyOptions, getCurrencySymbol } = useExchangeRate()

	// 免费或无价格直接返回简版
	if (price <= 0) {
		return (
			<div className="flex flex-col gap-2 select-text">
				<div className="text-base font-semibold">剩余价值计算面板</div>
				<div className="text-sm space-y-1">
					<div className="flex justify-between">
						<span>账单金额</span>
						<span>免费</span>
					</div>
					<div className="flex justify-between">
						<span>到期时间</span>
						<span>{expiredAt ? new Date(expiredAt).toISOString().slice(0, 10) : '—'}</span>
					</div>
					<div className="flex justify-between font-semibold">
						<span>剩余价值</span>
						<span className="text-(--accent-11)">免费</span>
					</div>
				</div>
			</div>
		)
	}

	// 以本地时区的 00:00 计算日期差
	const now = new Date()
	const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())

	const billDisplay = formatPriceWithConversion(price, currency, billingCycle)

	const cycle = mapCycleToDays(billingCycle)

	// 剩余天数 floor((到期00:00 - 今天00:00)/天)
	const remainingDays = React.useMemo(() => {
		if (!expiredAt) return 0
		const end = new Date(expiredAt)
		const expiryStart = new Date(end.getFullYear(), end.getMonth(), end.getDate())
		const msPerDay = 24 * 60 * 60 * 1000
		const raw = Math.floor((expiryStart.getTime() - todayStart.getTime()) / msPerDay)
		return Math.max(0, raw)
	}, [expiredAt, todayStart])

	// 剩余价值 = 价格 / 周期基准天数 * 剩余天数（在原币种里算），展示时再转换
	const remainingValue = (price / cycle.days) * remainingDays
	const displayRemainingDefault = formatCurrencyWithConversion(remainingValue, currency, undefined, { showSymbol: true, decimalPlaces: 3 })

	// 汇率（将 1 原货币 -> 当前显示货币）
	const rate = convertCurrency(1, currency, currentCurrency)

	const formatDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
	const formatStamp = (d: Date) =>
		`${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(
			d.getSeconds()
		).padStart(2, '0')}`

	// ---------------- 自定义参数（折叠）与应用后的计算 ----------------
	const [isCustomOpen, setIsCustomOpen] = React.useState(false)
	const defaultDateStr = React.useMemo(() => todayStart.toISOString().slice(0, 10), [todayStart])
	const [customCurrency, setCustomCurrency] = React.useState<string>(currentCurrency)
	const [customRateInput, setCustomRateInput] = React.useState<string>(() => {
		const r = convertCurrency(1, currency, currentCurrency)
		return Number.isFinite(r) ? String(Number(r.toFixed(6))) : '1'
	})
	const [customDate, setCustomDate] = React.useState<string>(defaultDateStr)

	const [appliedCurrency, setAppliedCurrency] = React.useState<string>(currentCurrency)
	const [appliedRate, setAppliedRate] = React.useState<number>(rate)
	const [appliedDate, setAppliedDate] = React.useState<string>(defaultDateStr)

	React.useEffect(() => {
		const r = convertCurrency(1, currency, customCurrency)
		if (!Number.isNaN(r) && Number.isFinite(r)) {
			setCustomRateInput(String(Number(r.toFixed(6))))
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [currency, customCurrency])

	const onClickCalculate = () => {
		const parsed = parseFloat(customRateInput)
		if (!Number.isFinite(parsed) || parsed <= 0) return
		setAppliedCurrency(customCurrency)
		setAppliedRate(parsed)
		setAppliedDate(customDate || defaultDateStr)
	}

	const effectiveTodayStart = React.useMemo(() => {
		const d = appliedDate ? new Date(appliedDate) : todayStart
		return new Date(d.getFullYear(), d.getMonth(), d.getDate())
	}, [appliedDate, todayStart])

	const effectiveRemainingDays = React.useMemo(() => {
		if (!expiredAt) return 0
		const end = new Date(expiredAt)
		const expiryStart = new Date(end.getFullYear(), end.getMonth(), end.getDate())
		const msPerDay = 24 * 60 * 60 * 1000
		const raw = Math.floor((expiryStart.getTime() - effectiveTodayStart.getTime()) / msPerDay)
		return Math.max(0, raw)
	}, [expiredAt, effectiveTodayStart])

	const remainingValueApplied = (price / cycle.days) * effectiveRemainingDays

	const displayRemainingApplied = React.useMemo(() => {
		const converted = remainingValueApplied * appliedRate
		const symbol = getCurrencySymbol(appliedCurrency)
		const formatted = new Intl.NumberFormat(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(converted)
		return `${symbol}${formatted}`
	}, [remainingValueApplied, appliedRate, appliedCurrency, getCurrencySymbol])

	const isApplied = React.useMemo(() => {
		return Math.abs(appliedRate - rate) > 1e-9 || appliedCurrency !== currentCurrency || appliedDate !== defaultDateStr
	}, [appliedRate, appliedCurrency, appliedDate, rate, currentCurrency, defaultDateStr])

	const displayRemaining = isApplied ? displayRemainingApplied : displayRemainingDefault

	// 导出计算所需的有效参数
	const effectiveDateForExport = isApplied ? new Date(appliedDate) : todayStart
	const effectiveRemainingDaysForExport = isApplied ? effectiveRemainingDays : remainingDays
	const effectiveRemainingValueForExport = isApplied ? remainingValueApplied : remainingValue
	const referenceRateForExport = rate // 系统实时参考汇率
	const foreignRateForExport = isApplied ? appliedRate : referenceRateForExport // 用户输入汇率（未应用时与参考一致）
	const targetCurrencyForExport = isApplied ? appliedCurrency : currentCurrency
	const targetSymbolForExport = getCurrencySymbol(targetCurrencyForExport)
	const originSymbolForExport = getCurrencySymbol(currency)

	const exportText = `\`\`\`markdown
## 剩余价值计算器

### 输入参数
- 参考汇率: ${referenceRateForExport.toFixed(3)}
- 输入汇率: ${foreignRateForExport.toFixed(3)}
- 续费金额: ${targetSymbolForExport}${(price * foreignRateForExport).toFixed(2)} (${originSymbolForExport}${price.toFixed(2)})
- 付款周期: ${cycle.label}
- 到期时间: ${expiredAt ? formatDate(new Date(expiredAt)) : '-'}
- 交易日期: ${formatDate(effectiveDateForExport)}

### 计算结果
- 交易日期: ${formatDate(effectiveDateForExport)}
- 外币汇率: ${foreignRateForExport.toFixed(3)}
- 续费价格: ${targetSymbolForExport}${(price * foreignRateForExport).toFixed(3)}/${cycle.unit} (${originSymbolForExport}${price.toFixed(3)}/${cycle.unit})
- 剩余天数: ${effectiveRemainingDaysForExport} 天 (于 ${expiredAt ? formatDate(new Date(expiredAt)) : '-'} 过期)
- 剩余价值: ${targetSymbolForExport}${(effectiveRemainingValueForExport * foreignRateForExport).toFixed(
		3
	)} (${originSymbolForExport}${effectiveRemainingValueForExport.toFixed(3)})

*导出时间: ${formatStamp(new Date())}*
\`\`\`
`

	const [copyStatus, setCopyStatus] = React.useState<'idle' | 'success' | 'error'>('idle')
	const resetCopyStatusLater = () => setTimeout(() => setCopyStatus('idle'), 2000)

	const handleCopy = async () => {
		try {
			await navigator.clipboard.writeText(exportText)
			setCopyStatus('success')
			resetCopyStatusLater()
		} catch {
			try {
				const item = new ClipboardItem({ 'text/plain': new Blob([exportText], { type: 'text/plain' }) })
				await navigator.clipboard.write([item])
				setCopyStatus('success')
				resetCopyStatusLater()
			} catch (err) {
				console.warn('复制失败，请手动复制：', err)
				setCopyStatus('error')
				resetCopyStatusLater()
			}
		}
	}

	return (
		<div className="flex flex-col gap-1 select-text">
			<div className="flex items-center justify-between">
				<div className="text-base font-semibold">剩余价值计算面板</div>
				<div className="flex items-center gap-2">
					<Button size="sm" variant="secondary" onClick={handleCopy} title="复制文本">
						{copyStatus === 'success' ? (
							<Check className="size-4 text-green-600" />
						) : copyStatus === 'error' ? (
							<X className="size-4 text-red-600" />
						) : (
							<Copy className="size-4" />
						)}
						复制
					</Button>
				</div>
			</div>
			<div className="text-sm">
				<div className="flex justify-between">
					<span>交易日期</span>
					<span>{(isApplied ? effectiveTodayStart : todayStart).toISOString().slice(0, 10)}</span>
				</div>
				<div className="flex justify-between">
					<span>到期时间</span>
					<span>{expiredAt ? new Date(expiredAt).toISOString().slice(0, 10) : '—'}</span>
				</div>
				<div className="flex justify-between">
					<span>账单金额</span>
					<span>{billDisplay}</span>
				</div>
				<div className="flex justify-between">
					<span>计算周期</span>
					<span>
						{cycle.days} 天
					</span>
				</div>
				<div className="flex justify-between">
					<span>剩余天数</span>
					<span>{isApplied ? effectiveRemainingDays : remainingDays} 天</span>
				</div>
				<div className="flex justify-between font-semibold">
					<span>剩余价值</span>
					<span className="text-(--accent-11)">{displayRemaining}</span>
				</div>
			</div>

			{/* 自定义参数折叠按钮 */}
			<div className="flex justify-center">
				<Button variant="link" size="sm" onClick={() => setIsCustomOpen(v => !v)}>
					{isCustomOpen ? '↑收起自定义参数' : '↓自定义参数'}
				</Button>
			</div>

			{isCustomOpen && (
				<div className="mt-1 p-2 rounded-lg border border-(--accent-a4) theme-card-style text-sm flex flex-col gap-2">
					<div className="flex items-center justify-between">
						<span className="text-muted-foreground">原始金额</span>
						<span className="font-medium">
							{price.toFixed(2)} {currency}
						</span>
					</div>
					<div className="flex flex-col gap-2 w-full">
						<div className="flex items-center justify-between gap-2">
							<span className="text-muted-foreground">外汇汇率</span>
							<Input
								type="number"
								inputMode="decimal"
								step="0.0001"
								min="0"
								className="h-8 w-28"
								value={customRateInput}
								onChange={e => setCustomRateInput(e.target.value)}
							/>
						</div>
						<div className="flex items-center justify-between gap-2">
							<span className="text-muted-foreground">交易货币</span>
							<select
								className="h-8 px-2 rounded-md border border-(--accent-a4) bg-background w-40"
								value={customCurrency}
								onChange={e => setCustomCurrency(e.target.value)}
							>
								{currencyOptions.map(opt => (
									<option key={opt} value={opt}>
										{getCurrencySymbol(opt)} {opt}
									</option>
								))}
							</select>
						</div>
					</div>
					<div className="flex items-center justify-between gap-2">
						<span className="text-muted-foreground">交易时间</span>
						<Input type="date" className="h-8 w-40" value={customDate} onChange={e => setCustomDate(e.target.value)} />
					</div>
					<div className="flex justify-end">
						<Button size="sm" onClick={onClickCalculate}>
							计算
						</Button>
					</div>
				</div>
			)}
		</div>
	)
}
