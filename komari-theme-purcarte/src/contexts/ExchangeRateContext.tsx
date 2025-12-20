import { useState, useEffect, useCallback, createContext, useContext, useMemo, type ReactNode } from 'react'
import { exchangeRateService, type ExchangeRateData } from '@/services/exchangeRate'
import { useConfigItem } from '@/config/hooks'
import { useCurrencySwitch } from '@/hooks/useCurrencySwitch'
import { formatPrice, formatCurrency, calculateRemainingValue, calculateMonthlyRenewal } from '@/utils/formatHelper'

function useExchangeRateInternal() {
	const [rates, setRates] = useState<ExchangeRateData | null>(null)
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [lastFetched, setLastFetched] = useState<number>(0)

	// 获取配置
	const currencyApi = useConfigItem('currencyApi') as 'exchangerate' | 'currency'
	const enableCurrencySymbol = useConfigItem('enableCurrencySymbol') as boolean

	// 使用货币切换hook
	const { currentCurrency, switchCurrency, currencyOptions } = useCurrencySwitch()

	// 获取汇率数据
	const fetchRates = useCallback(
		async (force = false) => {
			const now = Date.now()
			const ONE_HOUR = 60 * 60 * 1000

			// 如果不是强制刷新且数据仍然新鲜，则跳过
			if (!force && rates && now - lastFetched < ONE_HOUR) {
				return
			}

			setLoading(true)
			setError(null)

			try {
				const newRates = await exchangeRateService.getExchangeRates(currencyApi)
				if (newRates) {
					setRates(newRates)
					setLastFetched(now)
				} else {
					throw new Error('Failed to fetch exchange rates')
				}
			} catch (err) {
				const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred'
				setError(errorMessage)
			} finally {
				setLoading(false)
			}
		},
		[currencyApi, rates, lastFetched]
	)

	// 自动获取汇率数据
	useEffect(() => {
		fetchRates()
	}, [fetchRates]) // 当 fetchRates 函数改变时重新获取

	// 转换货币
	const convertCurrency = useCallback(
		(amount: number, fromCurrency: string, toCurrency?: string): number => {
			if (!rates) return amount

			const targetCurrency = toCurrency || currentCurrency
			return exchangeRateService.convertCurrency(amount, fromCurrency, targetCurrency, rates)
		},
		[rates, currentCurrency]
	)

	// 获取货币符号
	const getCurrencySymbol = useCallback(
		(currencyCode?: string): string => {
			const targetCurrency = currencyCode || currentCurrency
			return exchangeRateService.getCurrencySymbol(targetCurrency)
		},
		[currentCurrency]
	)

	// 格式化价格（带汇率转换）
	const formatPriceWithConversion = useCallback(
		(price: number, currency: string, billingCycle: number, targetCurrency?: string): string => {
			if (price <= 0) {
				return '免费'
			}
			if (!rates) {
				// 如果没有汇率数据，使用原始格式
				return formatPrice(price, currency, billingCycle, {
					showSymbol: enableCurrencySymbol
				})
			}
			const finalTargetCurrency = targetCurrency || currentCurrency
			const convertedPrice = convertCurrency(price, currency, finalTargetCurrency)
			const currencySymbol = getCurrencySymbol(finalTargetCurrency)

			return formatPrice(convertedPrice, currencySymbol, billingCycle, {
				showSymbol: enableCurrencySymbol
			})
		},
		[rates, currentCurrency, enableCurrencySymbol, convertCurrency, getCurrencySymbol]
	)

	// 格式化货币金额（带汇率转换）
	const formatCurrencyWithConversion = useCallback(
		(
			amount: number,
			currency: string,
			targetCurrency?: string,
			options?: {
				showSymbol?: boolean
				decimalPlaces?: number
			}
		): string => {
			if (!rates) {
				// 如果没有汇率数据，使用原始格式
				return formatCurrency(amount, currency, {
					showSymbol: enableCurrencySymbol,
					...options
				})
			}

			const finalTargetCurrency = targetCurrency || currentCurrency
			const convertedAmount = convertCurrency(amount, currency, finalTargetCurrency)
			const currencySymbol = getCurrencySymbol(finalTargetCurrency)

			return formatCurrency(convertedAmount, currencySymbol, {
				showSymbol: options?.showSymbol ?? enableCurrencySymbol,
				decimalPlaces: options?.decimalPlaces
			})
		},
		[rates, currentCurrency, enableCurrencySymbol, convertCurrency, getCurrencySymbol]
	)

	// 计算转换后的剩余价值
	const calculateRemainingValueWithConversion = useCallback(
		(price: number, currency: string, billingCycle: number, expiredAt: string | null, targetCurrency?: string): number => {
			if (price <= 0) {
				return 0
			}
			if (!rates) {
				return calculateRemainingValue(price, billingCycle, expiredAt)
			}

			const finalTargetCurrency = targetCurrency || currentCurrency
			const convertedPrice = convertCurrency(price, currency, finalTargetCurrency)
			return calculateRemainingValue(convertedPrice, billingCycle, expiredAt)
		},
		[rates, currentCurrency, convertCurrency]
	)

	// 计算转换后的月续费
	const calculateMonthlyRenewalWithConversion = useCallback(
		(price: number, currency: string, billingCycle: number, targetCurrency?: string): number => {
			if (price <= 0) return 0
			if (!rates) {
				return calculateMonthlyRenewal(price, billingCycle)
			}

			const finalTargetCurrency = targetCurrency || currentCurrency
			const convertedPrice = convertCurrency(price, currency, finalTargetCurrency)
			return calculateMonthlyRenewal(convertedPrice, billingCycle)
		},
		[rates, currentCurrency, convertCurrency]
	)

	// 汇率是否可用
	const isRatesAvailable = useMemo(() => rates !== null, [rates])

	// 汇率更新时间
	const ratesUpdatedAt = useMemo(() => {
		if (!rates) return null
		return rates.lastUpdated ? new Date(rates.lastUpdated) : new Date(rates.date)
	}, [rates])

	return {
		// 状态
		rates,
		loading,
		error,
		isRatesAvailable,
		ratesUpdatedAt,

		// 配置
		currentCurrency: currentCurrency,
		switchCurrency,
		currencyOptions,
		currencyApi,
		showCurrencySymbol: enableCurrencySymbol,

		// 方法
		fetchRates,
		convertCurrency,
		getCurrencySymbol,

		// 格式化方法
		formatPriceWithConversion,
		formatCurrencyWithConversion,
		calculateRemainingValueWithConversion,
		calculateMonthlyRenewalWithConversion
	}
}

type ExchangeRateContextType = ReturnType<typeof useExchangeRateInternal>

const ExchangeRateContext = createContext<ExchangeRateContextType | null>(null)

// Hook to use exchange rate context
export const useExchangeRate = () => {
	const context = useContext(ExchangeRateContext)
	if (!context) {
		throw new Error('useExchangeRate must be used within an ExchangeRateProvider')
	}
	return context
}

interface ExchangeRateProviderProps {
	children: ReactNode
}

export const ExchangeRateProvider = ({ children }: ExchangeRateProviderProps) => {
	const exchangeRateData = useExchangeRateInternal()
	return <ExchangeRateContext.Provider value={exchangeRateData}>{children}</ExchangeRateContext.Provider>
}
