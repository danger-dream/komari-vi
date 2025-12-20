import { useState, useEffect, createContext, useContext, type ReactNode } from 'react'
import { getWsService } from '../services/api'
import type { NodeStats } from '../types/node'
import { useNodeData } from './NodeDataContext'

interface LiveData {
	online: string[]
	data: { [uuid: string]: NodeStats }
}

interface LiveDataContextType {
	liveData: LiveData | null
}

const LiveDataContext = createContext<LiveDataContextType | null>(null)

// eslint-disable-next-line react-refresh/only-export-components
export const useLiveData = () => {
	const context = useContext(LiveDataContext)
	if (!context) {
		throw new Error('useLiveData must be used within a LiveDataProvider')
	}
	return context
}

interface LiveDataProviderProps {
	children: ReactNode
	enableWebSocket?: boolean
}

export const LiveDataProvider = ({ children, enableWebSocket = true }: LiveDataProviderProps) => {
	const [liveData, setLiveData] = useState<LiveData | null>(null)
	const { nodes, loading } = useNodeData()

	useEffect(() => {
		// 只有在加载完成、站点非私有且启用了 WebSocket 时才连接
		if (!loading && nodes !== 'private' && enableWebSocket) {
			const wsService = getWsService() // 在需要时才获取实例
			const handleWebSocketData = (data: LiveData) => {
				if (data.online && data.data) {
					setLiveData({
						online: [...data.online],
						data: { ...data.data }
					})
				}
			}

			const unsubscribe = wsService.subscribe(handleWebSocketData)
			wsService.connect()

			return () => {
				unsubscribe()
				wsService.disconnect() // 确保在组件卸载或条件变化时断开连接
			}
		} else {
			// 如果条件不满足，确保断开任何现有连接
			const wsService = getWsService() // 获取实例以调用 disconnect
			wsService.disconnect()
			setLiveData(null)
		}
	}, [loading, nodes, enableWebSocket])

	return <LiveDataContext.Provider value={{ liveData }}>{children}</LiveDataContext.Provider>
}
