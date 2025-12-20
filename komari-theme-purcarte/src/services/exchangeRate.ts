// 汇率数据接口
export interface ExchangeRateData {
	base: string
	date: string
	rates: Record<string, number>
	lastUpdated?: number
}

// ExchangeRate API 响应类型
interface ExchangeRateAPIResponse {
	provider: string
	WARNING_UPGRADE_TO_V6?: string
	terms: string
	base: string
	date: string
	time_last_updated: number
	rates: Record<string, number>
}

// Currency API 响应类型
interface CurrencyAPIResponse {
	usd: Record<string, number>
}

// 货币映射表
export const currencyMap: Record<string, string> = {
	'¥': 'CNY',
	'￥': 'CNY',
	$: 'USD',
	'€': 'EUR',
	'£': 'GBP',
	'₽': 'RUB',
	'₣': 'CHF',
	'₹': 'INR',
	'₫': 'VND',
	'฿': 'THB',
	'₩': 'KRW',
	'₱': 'PHP',

	人民币: 'CNY',
	美元: 'USD',
	欧元: 'EUR',
	英镑: 'GBP',
	日元: 'JPY',
	香港元: 'HKD',
	港币: 'HKD',
	澳门元: 'MOP',
	新台币: 'TWD',
	新加坡元: 'SGD',
	韩元: 'KRW',
	印度卢比: 'INR',
	墨西哥比索: 'MXN',
	加拿大元: 'CAD',
	澳大利亚元: 'AUD',
	新西兰元: 'NZD',
	瑞士法郎: 'CHF',
	瑞典克朗: 'SEK',
	挪威克朗: 'NOK',
	丹麦克朗: 'DKK',
	俄罗斯卢布: 'RUB',
	土耳其里拉: 'TRY',
	南非兰特: 'ZAR',
	阿根廷比索: 'ARS',
	智利比索: 'CLP',
	哥伦比亚比索: 'COP',
	越南盾: 'VND',
	泰国铢: 'THB',
	菲律宾比索: 'PHP',
	马来西亚林吉特: 'MYR'
}

class ExchangeRateService {
	private cache: Map<string, { data: ExchangeRateData; timestamp: number }> = new Map()
	private readonly CACHE_DURATION = 60 * 60 * 1000 // 1小时缓存

	/**
	 * 获取汇率数据
	 * @param apiType API类型：'exchangerate' 或 'currency'
	 * @returns 汇率数据
	 */
	async getExchangeRates(apiType: 'exchangerate' | 'currency' = 'exchangerate'): Promise<ExchangeRateData | null> {
		const cacheKey = `rates_${apiType}`
		const now = Date.now()

		// 检查缓存
		const cached = this.cache.get(cacheKey)
		if (cached && now - cached.timestamp < this.CACHE_DURATION) {
			return cached.data
		}

		try {
			let data: ExchangeRateData

			if (apiType === 'exchangerate') {
				data = await this.fetchExchangeRateAPI()
			} else {
				data = await this.fetchCurrencyAPI()
			}

			// 更新缓存
			this.cache.set(cacheKey, { data, timestamp: now })
			return data
		} catch (error) {
			console.error(`Failed to fetch exchange rates from ${apiType}:`, error)

			// 返回缓存的数据，即使过期了也比没有好
			if (cached) {
				return cached.data
			}

			return null
		}
	}

	/**
	 * 从 ExchangeRate API 获取汇率数据
	 */
	private async fetchExchangeRateAPI(): Promise<ExchangeRateData> {
		const response = await fetch('https://api.exchangerate-api.com/v4/latest/USD')
		if (!response.ok) {
			throw new Error(`ExchangeRate API error: ${response.status}`)
		}
		const data: ExchangeRateAPIResponse = await response.json()
		return {
			base: data.base,
			date: data.date,
			rates: data.rates,
			lastUpdated: data.time_last_updated * 1000 // 转换为毫秒
		}
	}

	/**
	 * 从 Currency API 获取汇率数据
	 */
	private async fetchCurrencyAPI(): Promise<ExchangeRateData> {
		const response = await fetch('https://latest.currency-api.pages.dev/v1/currencies/usd.json')
		if (!response.ok) {
			throw new Error(`Currency API error: ${response.status}`)
		}
		const data: CurrencyAPIResponse = await response.json()
		return {
			base: 'USD',
			date: new Date().toISOString().split('T')[0], // 当前日期
			rates: {
				USD: 1,
				...Object.fromEntries(Object.entries(data.usd).map(([k, v]) => [k.toUpperCase(), v]))
			}
		}
	}

	/**
	 * 转换货币
	 * @param amount 金额
	 * @param fromCurrency 源货币代码
	 * @param toCurrency 目标货币代码
	 * @param rates 汇率数据
	 * @returns 转换后的金额
	 */
	convertCurrency(amount: number, fromCurrency: string, toCurrency: string, rates: ExchangeRateData): number {
		if (fromCurrency === toCurrency) {
			return amount
		}
		// 获取源货币和目标货币的汇率
		const fromRate = this.getCurrencyRate(fromCurrency, rates)
		const toRate = this.getCurrencyRate(toCurrency, rates)
		if (fromRate === null || toRate === null) {
			return amount // 如果无法转换，返回原金额
		}
		// 先转换为基准货币(USD)，再转换为目标货币
		return (amount / fromRate) * toRate
	}

	/**
	 * 获取指定货币的汇率
	 * @param currencyCode 货币代码
	 * @param rates 汇率数据
	 * @returns 汇率值
	 */
	private getCurrencyRate(currencyCode: string, rates: ExchangeRateData): number | null {
		// 标准化货币代码
		const normalizedCode = this.normalizeCurrencyCode(currencyCode)
		if (normalizedCode === rates.base) {
			return 1
		}
		return rates.rates[normalizedCode.toUpperCase()] || null
	}

	/**
	 * 标准化货币代码
	 * @param currencyCode 货币符号
	 * @returns 标准货币代码
	 */
	private normalizeCurrencyCode(currencyCode: string): string {
		return currencyMap[currencyCode.toUpperCase()] || currencyCode.toUpperCase()
	}

	/**
	 * 获取货币符号
	 * @param currencyCode 显示名称
	 * @returns 货币符号
	 */
	getCurrencySymbol(currencyCode: string): string {
		const symbolMap: Record<string, string> = {
			人民币: '￥',
			美元: '$',
			欧元: '€',
			英镑: '£',
			日元: '¥',
			香港元: '$',
			澳门元: 'P',
			新台币: '$',
			新加坡元: '$',
			韩元: '₩',
			印度卢比: '₹',
			墨西哥比索: '$',
			加拿大元: '$',
			澳大利亚元: '$',
			新西兰元: '$',
			瑞士法郎: 'Fr',
			瑞典克朗: 'kr',
			挪威克朗: 'kr',
			丹麦克朗: 'kr',
			俄罗斯卢布: '₽',
			土耳其里拉: '₤',
			南非兰特: 'R',
			阿根廷比索: '$',
			智利比索: '$',
			哥伦比亚比索: '$',
			越南盾: '₫',
			泰国铢: '฿',
			菲律宾比索: '₱',
			马来西亚林吉特: 'RM'
		}
		return symbolMap[currencyCode] || currencyCode
	}

	/**
	 * 清除缓存
	 */
	clearCache(): void {
		this.cache.clear()
	}
}

// 创建汇率服务实例
export const exchangeRateService = new ExchangeRateService()
