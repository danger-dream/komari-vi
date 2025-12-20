import { useState, useEffect, useCallback, createContext, useContext, type ReactNode } from 'react'
import { apiService } from '../services/api'
import type { NodeData, PublicInfo, HistoryRecord } from '../types/node'
import { compareServersByWeightName } from '../utils/serverSort'

// The core logic from the original useNodeData.ts, now kept internal to this file.
function useNodesInternal() {
	const [staticNodes, setStaticNodes] = useState<NodeData[] | 'private'>([])
	const [publicSettings, setPublicSettings] = useState<PublicInfo | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)

	const fetchNodes = useCallback(async () => {
		setLoading(true)
		setError(null)

		try {
			const [nodeData, publicSettings] = await Promise.all([apiService.getNodes(), apiService.getPublicSettings()])

			if (nodeData === 'private') {
				setStaticNodes('private')
			} else {
				const sortedNodes = [...nodeData].sort(compareServersByWeightName)
				setStaticNodes(sortedNodes)
			}

			setPublicSettings(publicSettings)
		} catch (err) {
			setError(err instanceof Error ? err.message : '获取节点数据失败')
		} finally {
			setLoading(false)
		}
	}, [])

	const refreshNodes = useCallback(async () => {
		await fetchNodes()
	}, [fetchNodes])

	useEffect(() => {
		fetchNodes()
	}, [fetchNodes])

	const getNodeDetails = useCallback(async (uuid: string) => {
		try {
			const recentStats = await apiService.getNodeRecentStats(uuid)
			return { recentStats }
		} catch (err) {
			console.error('Failed to fetch node recent stats:', err)
			return null
		}
	}, [])

	const getLoadHistory = useCallback(async (uuid: string, hours: number = 24) => {
		try {
			const loadHistory = await apiService.getLoadHistory(uuid, hours)
			return loadHistory
		} catch (err) {
			console.error('Failed to fetch load history:', err)
			return null
		}
	}, [])

	const getPingHistory = useCallback(async (uuid: string, hours: number = 24) => {
		try {
			const pingHistory = await apiService.getPingHistory(uuid, hours)
			return pingHistory
		} catch (err) {
			console.error('Failed to fetch ping history:', err)
			return null
		}
	}, [])

	const getSPPingHistory = useCallback(async (uuid: string, hours: number = 24) => {
		try {
			const spPingHistory = await apiService.getSPPingHistory(uuid, hours)
			return spPingHistory
		} catch (err) {
			console.error('Failed to fetch SP ping history:', err)
			return null
		}
	}, [])

	const getRecentLoadHistory = useCallback(async (uuid: string) => {
		try {
			const recentStats = await apiService.getNodeRecentStats(uuid)
			if (!recentStats) return null

			const records: HistoryRecord[] = recentStats.map(stat => ({
				client: uuid,
				time: stat.updated_at,
				cpu: stat.cpu.usage,
				ram: stat.ram.used,
				disk: stat.disk.used,
				load: stat.load.load1,
				net_in: stat.network.down,
				net_out: stat.network.up,
				process: stat.process,
				connections: stat.connections.tcp + stat.connections.udp,
				gpu: 0,
				ram_total: stat.ram.total,
				swap: stat.swap.used,
				swap_total: stat.swap.total,
				temp: 0,
				disk_total: stat.disk.total,
				net_total_up: stat.network.totalUp,
				net_total_down: stat.network.totalDown,
				connections_udp: stat.connections.udp
			}))

			return { count: records.length, records }
		} catch (err) {
			console.error('Failed to fetch recent load history:', err)
			return null
		}
	}, [])

	const getNodesByGroup = useCallback(
		(group: string) => {
			if (Array.isArray(staticNodes)) {
				return staticNodes.filter(node => node.group === group)
			}
			return []
		},
		[staticNodes]
	)

	const getGroups = useCallback(() => {
		if (Array.isArray(staticNodes)) {
			return Array.from(new Set(staticNodes.map(node => node.group).filter(Boolean)))
		}
		return []
	}, [staticNodes])

	return {
		nodes: staticNodes,
		publicSettings,
		loading,
		error,
		refreshNodes,
		getNodeDetails,
		getLoadHistory,
		getPingHistory,
		getSPPingHistory,
		getRecentLoadHistory,
		getNodesByGroup,
		getGroups
	}
}

type NodeDataContextType = ReturnType<typeof useNodesInternal>

const NodeDataContext = createContext<NodeDataContextType | null>(null)

// eslint-disable-next-line react-refresh/only-export-components
export const useNodeData = () => {
	const context = useContext(NodeDataContext)
	if (!context) {
		throw new Error('useNodeData must be used within a NodeDataProvider')
	}
	return context
}

interface NodeDataProviderProps {
	children: ReactNode
}

export const NodeDataProvider = ({ children }: NodeDataProviderProps) => {
	const nodeData = useNodesInternal()
	return <NodeDataContext.Provider value={nodeData}>{children}</NodeDataContext.Provider>
}
