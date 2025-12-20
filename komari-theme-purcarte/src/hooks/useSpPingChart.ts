import { useState, useEffect } from 'react'
import { useNodeData } from '@/contexts/NodeDataContext'
import type { NodeData, SPPingHistoryResponse } from '@/types/node'

export const useSpPingChart = (node: NodeData | null, hours: number) => {
	const { getSPPingHistory } = useNodeData()
	const [history, setHistory] = useState<SPPingHistoryResponse | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		if (!node?.uuid) {
			setHistory(null)
			setLoading(false)
			return
		}
		setLoading(true)
		setError(null)
		const fetchHistory = async () => {
			try {
				const data = await getSPPingHistory(node.uuid, hours)
				setHistory(data)
			} catch (err: any) {
				setError(err?.message || 'Failed to fetch SP ping history')
			} finally {
				setLoading(false)
			}
		}
		fetchHistory()
	}, [node?.uuid, hours, getSPPingHistory])

	return { loading, error, history }
}
