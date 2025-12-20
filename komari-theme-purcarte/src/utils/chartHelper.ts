import type { PingTask } from '@/types/node'

/**
 * 根据任务名称和任务列表生成颜色
 * @param taskName - 任务名称
 * @param sortedTasks - 已排序的任务列表
 * @returns CSS 颜色字符串
 */
export const generateColor = (taskName: string, sortedTasks: PingTask[]) => {
	const index = sortedTasks.findIndex(t => t.name === taskName)
	if (index === -1) return '#000000' // Fallback color

	const total = sortedTasks.length
	const hue = (index * (360 / total)) % 360

	// 使用OKLCH色彩空间，优化折线图的颜色区分度
	const oklchColor = `oklch(0.6 0.2 ${hue} / .8)`

	// 为不支持OKLCH的浏览器提供HSL备用色
	const hslFallback = `hsl(${hue}, 50%, 60%)`

	// 检查浏览器是否支持OKLCH
	if (typeof window !== 'undefined' && window.CSS && CSS.supports('color', oklchColor)) {
		return oklchColor
	} else {
		return hslFallback
	}
}

/**
 * 格式化图表X轴的标签
 * @param value - 时间戳
 * @param hours - 当前选择的时间范围（小时）
 * @returns 格式化后的时间字符串
 */
export const lableFormatter = (value: any, hours: number) => {
	const date = new Date(value)
	if (hours === 0) {
		return date.toLocaleTimeString([], {
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		})
	}
	return date.toLocaleString([], {
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit'
	})
}

/**
 * 格式化负载图表X轴的时间标签
 * @param value - 时间戳
 * @param index - 索引
 * @param dataLength - 数据总长度
 * @returns 格式化后的时间字符串 (只显示首尾)
 */
export const loadChartTimeFormatter = (value: any, index: number, dataLength: number) => {
	if (dataLength === 0) return ''
	if (index === 0 || index === dataLength - 1) {
		return new Date(value).toLocaleTimeString([], {
			hour: '2-digit',
			minute: '2-digit'
		})
	}
	return ''
}
