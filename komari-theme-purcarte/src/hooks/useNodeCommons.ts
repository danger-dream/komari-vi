import { useMemo } from 'react'
import type { NodeWithStatus } from '@/types/node'
import { useExchangeRate } from '@/contexts/ExchangeRateContext'
import type { TagItem } from '@/types/tags'

export const useNodeCommons = (node: NodeWithStatus) => {
	const { stats, isOnline } = useMemo(() => {
		return {
			stats: node.stats,
			isOnline: node.status === 'online'
		}
	}, [node])

	let priceTag: TagItem | null = null
	if (node.price && node.billing_cycle) {
		const { formatPriceWithConversion } = useExchangeRate()
		const priceText = formatPriceWithConversion(node.price, node.currency, node.billing_cycle)
		priceTag = {
			type: 'price',
			text: priceText,
			color: null,
			payload: {
				price: node.price,
				currency: node.currency,
				billingCycle: node.billing_cycle,
				expiredAt: node.expired_at
			}
		}
	}
	const cpuUsage = stats && isOnline ? stats.cpu.usage : 0
	const memUsage = stats && isOnline && stats.ram.total > 0 ? (stats.ram.used / stats.ram.total) * 100 : 0
	const swapUsage = stats && isOnline && stats.swap.total > 0 ? (stats.swap.used / stats.swap.total) * 100 : 0
	const diskUsage = stats && isOnline && stats.disk.total > 0 ? (stats.disk.used / stats.disk.total) * 100 : 0

	const load = stats ? `${stats.load.load1.toFixed(2)} | ${stats.load.load5.toFixed(2)} | ${stats.load.load15.toFixed(2)}` : 'N/A'

	const daysLeft = node.expired_at ? Math.ceil((new Date(node.expired_at).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)) : null

	let daysLeftTag = null
	if (daysLeft !== null) {
		if (daysLeft < 0) {
			daysLeftTag = '已过期<red>'
		} else if (daysLeft <= 7) {
			daysLeftTag = `余 ${daysLeft} 天<red>`
		} else if (daysLeft <= 15) {
			daysLeftTag = `余 ${daysLeft} 天<orange>`
		} else if (daysLeft < 36500) {
			daysLeftTag = `余 ${daysLeft} 天<green>`
		} else {
			daysLeftTag = '长期<green>'
		}
	}

	const expired_at = daysLeft !== null && daysLeft > 36500 ? '长期' : node.expired_at ? new Date(node.expired_at).toLocaleDateString() : '未设置'

	const tagList = [
		...(priceTag ? [priceTag] : []),
		...(daysLeftTag ? [daysLeftTag] : []),
		...(typeof node.tags === 'string'
			? node.tags
					.split(';')
					.map(tag => tag.trim())
					.filter(Boolean)
			: [])
	]

	// 计算流量使用百分比
	const trafficPercentage = useMemo(() => {
		if (!node.traffic_limit || !stats || !isOnline) return 0

		// 根据流量限制类型确定使用的流量值
		let usedTraffic = 0
		switch (node.traffic_limit_type) {
			case 'up':
				usedTraffic = stats.network.totalUp
				break
			case 'down':
				usedTraffic = stats.network.totalDown
				break
			case 'sum':
				usedTraffic = stats.network.totalUp + stats.network.totalDown
				break
			case 'min':
				usedTraffic = Math.min(stats.network.totalUp, stats.network.totalDown)
				break
			default: // max 或者未设置
				usedTraffic = Math.max(stats.network.totalUp, stats.network.totalDown)
				break
		}

		return (usedTraffic / node.traffic_limit) * 100
	}, [node.traffic_limit, node.traffic_limit_type, stats, isOnline])

	return {
		stats,
		isOnline,
		tagList,
		cpuUsage,
		memUsage,
		swapUsage,
		diskUsage,
		load,
		expired_at,
		trafficPercentage
	}
}
