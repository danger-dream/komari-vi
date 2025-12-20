import { useState, useCallback, useEffect } from 'react'
import { useConfigItem } from '@/config/hooks'

// 货币选项列表
export const CURRENCY_OPTIONS = [
	'人民币',
	'美元',
	'欧元',
	'英镑',
	'日元',
	'香港元',
	'澳门元',
	'新台币',
	'新加坡元',
	'韩元',
	'印度卢比',
	'墨西哥比索',
	'加拿大元',
	'澳大利亚元',
	'新西兰元',
	'瑞士法郎',
	'瑞典克朗',
	'挪威克朗',
	'丹麦克朗',
	'俄罗斯卢布',
	'土耳其里拉',
	'南非兰特',
	'阿根廷比索',
	'智利比索',
	'哥伦比亚比索',
	'越南盾',
	'泰国铢',
	'马来西亚林吉特',
	'菲律宾比索'
]

const STORAGE_KEY = 'komari_selected_currency'

export const useCurrencySwitch = () => {
	const defaultCurrency = useConfigItem('defaultCurrency')
	const [currentCurrency, setCurrentCurrency] = useState<string>(() => {
		try {
			const saved = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
			return saved || (defaultCurrency as string)
		} catch {
			return defaultCurrency as string
		}
	})

	// 当默认货币变更时，如果没有缓存，则回落到新的默认值
	useEffect(() => {
		try {
			const saved = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
			if (!saved) {
				setCurrentCurrency(defaultCurrency)
			}
		} catch {
			setCurrentCurrency(defaultCurrency)
		}
	}, [defaultCurrency])

	// 切换货币
	const switchCurrency = useCallback((currencyValue: string) => {
		setCurrentCurrency(currencyValue)
		localStorage.setItem(STORAGE_KEY, currencyValue)
	}, [])

	// 获取当前货币信息
	const getCurrentCurrencyInfo = useCallback(() => {
		return CURRENCY_OPTIONS.find(option => option === currentCurrency) || CURRENCY_OPTIONS[0]
	}, [currentCurrency])

	// 重置为默认货币
	const resetToDefault = useCallback(() => {
		setCurrentCurrency(defaultCurrency)
		localStorage.removeItem(STORAGE_KEY)
	}, [defaultCurrency])

	return {
		currentCurrency,
		switchCurrency,
		getCurrentCurrencyInfo,
		resetToDefault,
		currencyOptions: CURRENCY_OPTIONS,
		isDefault: currentCurrency === defaultCurrency
	}
}
