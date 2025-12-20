import { useEffect, useState } from 'react'
import { apiService } from '@/services/api'
import type { TaskPingHistoryResponse } from '@/types/node'

export const useTaskPingHistory = (taskId: number | null, hours: number) => {
	const [history, setHistory] = useState<TaskPingHistoryResponse | null>(null)
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		if (!taskId) {
			setHistory(null)
			setLoading(false)
			return
		}

		let cancelled = false
		const fetchHistory = async () => {
			setLoading(true)
			setError(null)
			try {
				const data = await apiService.getPingHistoryByTask(taskId, hours)
				if (!cancelled) {
					setHistory(data)
				}
			} catch (err: any) {
				if (!cancelled) {
					setError(err?.message || '获取任务延迟数据失败')
				}
			} finally {
				if (!cancelled) {
					setLoading(false)
				}
			}
		}

		fetchHistory()
		return () => {
			cancelled = true
		}
	}, [taskId, hours])

	return {
		history,
		loading,
		error
	}
}
