import { useCallback, useEffect, useState } from 'react'
import { apiService } from '@/services/api'
import type { PingTask } from '@/types/node'

export const usePingTasks = () => {
	const [tasks, setTasks] = useState<PingTask[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)

	const fetchTasks = useCallback(async () => {
		setLoading(true)
		setError(null)
		try {
			const list = await apiService.getPingTasks()
			setTasks(list)
		} catch (err) {
			setError(err instanceof Error ? err.message : '获取延迟任务失败')
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		fetchTasks()
	}, [fetchTasks])

	return {
		tasks,
		loading,
		error,
		refresh: fetchTasks
	}
}
