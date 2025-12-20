import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs))
}

// Helper function to format bytes
export const formatBytes = (bytes: number, isSpeed = false, decimals = 2) => {
	if (bytes === 0) return isSpeed ? '0 B/s' : '0 B'
	const k = 1024
	const dm = decimals < 0 ? 0 : decimals
	const sizes = isSpeed ? ['B/s', 'KB/s', 'MB/s', 'GB/s', 'TB/s'] : ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB']

	let i = Math.floor(Math.log(bytes) / Math.log(k))
	let value = bytes / Math.pow(k, i)

	// 如果值大于等于1000，则进位到下一个单位
	if (value >= 1000 && i < sizes.length - 1) {
		i++
		value = bytes / Math.pow(k, i)
	}

	return parseFloat(value.toFixed(dm)) + ' ' + sizes[i]
}

// Helper function to format uptime
export const formatUptime = (seconds: number) => {
	if (isNaN(seconds) || seconds < 0) {
		return 'N/A'
	}
	const days = Math.floor(seconds / (3600 * 24))
	seconds -= days * 3600 * 24
	const hrs = Math.floor(seconds / 3600)
	seconds -= hrs * 3600
	const mns = Math.floor(seconds / 60)

	let uptimeString = ''
	if (days > 0) {
		uptimeString += `${days}天`
	}
	if (hrs > 0) {
		uptimeString += `${hrs}小时`
	}
	if (mns > 0 && days === 0) {
		// Only show minutes if uptime is less than a day
		uptimeString += `${mns}分钟`
	}
	if (uptimeString === '') {
		return '刚刚'
	}

	return uptimeString
}

export const formatPrice = (
	price: number,
	currency: string,
	billingCycle: number,
	options?: {
		convertedPrice?: number
		targetCurrency?: string
		showSymbol?: boolean
	}
) => {
	if (price === -1) return '免费'
	if (price === 0) return ''
	if (!currency || !billingCycle) return 'N/A'

	// 使用转换后的价格和目标货币（如果提供）
	const finalPrice = options?.convertedPrice ?? price
	const finalCurrency = options?.targetCurrency ?? currency
	const showSymbol = options?.showSymbol ?? true

	let cycleStr = `${billingCycle}天`
	if (billingCycle < 0) {
		return showSymbol ? `${finalCurrency}${finalPrice.toFixed(2)}` : finalPrice.toFixed(2)
	} else if (billingCycle === 30 || billingCycle === 31) {
		cycleStr = '月'
	} else if (billingCycle >= 89 && billingCycle <= 92) {
		cycleStr = '季'
	} else if (billingCycle >= 180 && billingCycle <= 183) {
		cycleStr = '半年'
	} else if (billingCycle >= 364 && billingCycle <= 366) {
		cycleStr = '年'
	} else if (billingCycle >= 730 && billingCycle <= 732) {
		cycleStr = '两年'
	} else if (billingCycle >= 1095 && billingCycle <= 1097) {
		cycleStr = '三年'
	} else if (billingCycle >= 1825 && billingCycle <= 1827) {
		cycleStr = '五年'
	}

	return showSymbol ? `${finalCurrency}${finalPrice.toFixed(2)}/${cycleStr}` : `${finalPrice.toFixed(2)}/${cycleStr}`
}

// 格式化货币金额（不包含周期）
export const formatCurrency = (
	amount: number,
	currency: string,
	options?: {
		showSymbol?: boolean
		decimalPlaces?: number
	}
) => {
	if (amount === -1) return '免费'
	if (amount === 0) return '0'

	const showSymbol = options?.showSymbol ?? true
	const decimalPlaces = options?.decimalPlaces ?? 2
	const formattedAmount = amount.toFixed(decimalPlaces)

	return showSymbol ? `${currency}${formattedAmount}` : formattedAmount
}

// 计算剩余价值
export const calculateRemainingValue = (price: number, billingCycle: number, expiredAt: string | null): number => {
	if (price === -1 || price === 0 || !expiredAt || billingCycle <= 0) {
		return 0
	}

	const now = new Date()
	const expiredDate = new Date(expiredAt)
	const remainingDays = Math.max(0, Math.ceil((expiredDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))

	// 计算每天的价值
	const dailyValue = price / billingCycle

	return remainingDays * dailyValue
}

// 计算月续费（标准化为30天）
export const calculateMonthlyRenewal = (price: number, billingCycle: number): number => {
	if (price === -1 || price === 0 || billingCycle <= 0) {
		return 0
	}

	// 将价格标准化为每30天的费用
	return (price / billingCycle) * 30
}

export const formatTrafficLimit = (limit?: number, type?: 'sum' | 'max' | 'min' | 'up' | 'down') => {
	if (!limit) return '未设置'

	const limitText = formatBytes(limit)

	const typeText =
		{
			sum: '总和',
			max: '最大值',
			min: '最小值',
			up: '上传',
			down: '下载'
		}[type || 'max'] || ''

	return `总 ${limitText} (${typeText})`
}

export const getProgressBarClass = (percentage: number) => {
	if (percentage > 90) return 'bg-red-600'
	if (percentage > 50) return 'bg-yellow-400'
	return 'bg-green-500'
}
