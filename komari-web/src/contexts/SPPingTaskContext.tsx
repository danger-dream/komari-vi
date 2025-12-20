import React from 'react'

export interface SPPingTask {
	id?: number
	name?: string
	type?: string
	target?: string
	step?: number
	pings?: number
	timeout_ms?: number
	payload_size?: number
	clients?: string[]
	weight?: number
	[property: string]: any
}

interface Response {
	data: SPPingTask[]
	message: string
	status: string
	[property: string]: any
}

interface SPPingTaskContextType {
	tasks: SPPingTask[] | null
	isLoading: boolean
	error: string | null
	refresh: () => void
}

const SPPingTaskContext = React.createContext<SPPingTaskContextType | undefined>(undefined)

export const SPPingTaskProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const [tasks, setTasks] = React.useState<SPPingTask[] | null>(null)
	const [isLoading, setIsLoading] = React.useState<boolean>(false)
	const [error, setError] = React.useState<string | null>(null)
	const hasLoadedRef = React.useRef(false)

	const refresh = React.useCallback(() => {
		if (!hasLoadedRef.current) {
			setIsLoading(true)
		}
		setError(null)
		fetch('/api/admin/sp-ping')
			.then(response => {
				if (!response.ok) {
					throw new Error('Failed to fetch SP ping tasks')
				}
				return response.json()
			})
			.then((resp: Response) => {
				if (resp && Array.isArray(resp.data)) {
					setTasks(resp.data)
				} else {
					setTasks([])
				}
			})
			.catch(err => {
				setError(err.message || 'An error occurred while fetching SP ping tasks')
			})
			.finally(() => {
				hasLoadedRef.current = true
				setIsLoading(false)
			})
	}, [])

	React.useEffect(() => {
		refresh()
	}, [refresh])

	return <SPPingTaskContext.Provider value={{ tasks, isLoading, error, refresh }}>{children}</SPPingTaskContext.Provider>
}

export const useSPPingTask = () => {
	const context = React.useContext(SPPingTaskContext)
	if (!context) {
		throw new Error('useSPPingTask must be used within a SPPingTaskProvider')
	}
	return context
}
