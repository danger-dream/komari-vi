import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Badge, Button, Card, Flex, Grid, Text } from '@radix-ui/themes'
import { useTranslation } from 'react-i18next'
import { ArrowLeftIcon } from '@radix-ui/react-icons'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, BarChart, Bar, Tooltip } from 'recharts'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'

type ForwardStat = {
	node_id: string
	link_status: string
	active_connections: number
	traffic_in_bytes: number
	traffic_out_bytes: number
	realtime_bps_in: number
	realtime_bps_out: number
	nodes_latency: string
}

type ForwardHistory = {
	timestamp: string
	traffic_in_bytes: number
	traffic_out_bytes: number
}

type TopologyNode = {
	node_id: string
	name: string
	ip: string
	port?: number
	status?: string
	latency_ms?: number
	role: string
}

type Topology = {
	entry: TopologyNode
	relays: TopologyNode[]
	hops: { type: string; strategy?: string; relays?: TopologyNode[]; node?: TopologyNode; active_relay_node_id?: string }[]
	target: TopologyNode
	active_relay_node_id?: string
	type: string
}

type AlertHistory = {
	id: number
	alert_type: string
	severity: string
	message: string
	acknowledged: boolean
	created_at: string
}

const ForwardDashboard = () => {
	const { t } = useTranslation()
	const navigate = useNavigate()
	const { id } = useParams()
	const ruleId = Number(id || 0)
	const [stats, setStats] = useState<ForwardStat[]>([])
	const [history, setHistory] = useState<ForwardHistory[]>([])
	const [topology, setTopology] = useState<Topology | null>(null)
	const [totals, setTotals] = useState({ connections: 0, in: 0, out: 0 })
	const [alerts, setAlerts] = useState<AlertHistory[]>([])

	const fetchStats = async () => {
		if (!ruleId) return
		const res = await fetch(`/api/v1/forwards/${ruleId}/stats`)
		if (!res.ok) throw new Error(`HTTP ${res.status}`)
		const body = await res.json()
		setStats(body.data?.stats || [])
		setHistory(body.data?.history || [])
		setTotals({
			connections: body.data?.total_connections || 0,
			in: body.data?.total_traffic_in || 0,
			out: body.data?.total_traffic_out || 0
		})
	}

	const fetchTopology = async () => {
		if (!ruleId) return
		const res = await fetch(`/api/v1/forwards/${ruleId}/topology`)
		if (!res.ok) throw new Error(`HTTP ${res.status}`)
		const body = await res.json()
		setTopology(body.data || null)
	}

	const fetchAlerts = async () => {
		if (!ruleId) return
		const res = await fetch(`/api/v1/forwards/${ruleId}/alert-history?limit=20`)
		if (!res.ok) return
		const body = await res.json()
		setAlerts(body.data || [])
	}

	useEffect(() => {
		if (!ruleId) return
		const load = async () => {
			try {
				await Promise.all([fetchStats(), fetchTopology(), fetchAlerts()])
			} catch {
				// ignore
			}
		}
		load()
		const timer = setInterval(() => {
			fetchStats()
			fetchTopology()
		}, 5000)
		return () => clearInterval(timer)
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ruleId])

	const formatBytes = (bytes?: number) => {
		if (!bytes) return '0 B'
		const units = ['B', 'KB', 'MB', 'GB', 'TB']
		let idx = 0
		let value = bytes
		while (value >= 1024 && idx < units.length - 1) {
			value /= 1024
			idx++
		}
		const fixed = value >= 10 || idx === 0 ? 0 : 1
		return `${value.toFixed(fixed)} ${units[idx]}`
	}

	const chartData = useMemo(
		() =>
			history.map(item => ({
				time: new Date(item.timestamp).toLocaleTimeString(),
				in: item.traffic_in_bytes,
				out: item.traffic_out_bytes
			})),
		[history]
	)

	const latencyData = useMemo(
		() =>
			stats.map(s => ({
				name: s.node_id,
				latency: parseLatency(s.nodes_latency)
			})),
		[stats]
	)

	const entryStatus = topology?.entry?.status || 'unknown'
	const statusColor = (status: string) => {
		if (status === 'healthy') return 'green'
		if (status === 'degraded') return 'yellow'
		if (status === 'faulty') return 'red'
		return 'gray'
	}

	const ackAlert = async (alertId: number) => {
		if (!ruleId) return
		const res = await fetch(`/api/v1/forwards/${ruleId}/alert-history/${alertId}/acknowledge`, { method: 'POST' })
		if (res.ok) fetchAlerts()
	}

	return (
		<Flex direction="column" gap="4" className="p-4">
			<Flex justify="between" align="center">
				<Flex gap="2" align="center">
					<Button variant="ghost" onClick={() => navigate(-1)}>
						<ArrowLeftIcon /> {t('common.back', { defaultValue: '返回' })}
					</Button>
					<Text size="6" weight="bold">
						{t('forward.dashboard', { defaultValue: '转发监控面板' })}
					</Text>
				</Flex>
			</Flex>

			<Grid columns="2" gap="4">
				<Card>
					<Text weight="bold">{t('forward.topology', { defaultValue: '链路拓扑' })}</Text>
					<div className="mt-3 flex flex-wrap items-center gap-2">
						<Badge color="gray">客户端</Badge>
						<Text>→</Text>
						<Badge color={statusColor(entryStatus)}>{topology?.entry?.name || '-'}</Badge>
						{topology?.type === 'relay_group' && (
							<>
								<Text>→</Text>
								<Badge color="gray">{t('forward.relayGroup')}</Badge>
								{topology?.relays?.map(relay => (
									<Badge key={relay.node_id} color={relay.node_id === topology?.active_relay_node_id ? 'green' : 'gray'}>
										{relay.name || relay.node_id}
									</Badge>
								))}
							</>
						)}
						{topology?.type === 'chain' &&
							topology?.hops?.map((hop, idx) => (
								<Flex key={`${hop.type}-${idx}`} align="center" gap="2">
									<Text>→</Text>
									<Badge color="gray">{hop.type}</Badge>
									{hop.node && <Badge color={statusColor(hop.node.status || '')}>{hop.node.name}</Badge>}
									{hop.relays?.map(relay => (
										<Badge key={relay.node_id} color={relay.node_id === hop.active_relay_node_id ? 'green' : 'gray'}>
											{relay.name || relay.node_id}
										</Badge>
									))}
								</Flex>
							))}
						<Text>→</Text>
						<Badge color="gray">{topology?.target?.name || topology?.target?.ip || '-'}</Badge>
					</div>
				</Card>

				<Card>
					<Text weight="bold">{t('forward.coreStatus', { defaultValue: '核心状态' })}</Text>
					<Flex gap="3" mt="3" align="center">
						<Badge color={statusColor(entryStatus)}>{entryStatus}</Badge>
						<Text>
							{t('chart.connections')}: {totals.connections}
						</Text>
						<Text>
							{t('common.traffic', { defaultValue: '流量' })}: {formatBytes(totals.in)} / {formatBytes(totals.out)}
						</Text>
					</Flex>
				</Card>
			</Grid>

			<Grid columns="2" gap="4">
				<Card>
					<Text weight="bold">{t('forward.realtimeTraffic', { defaultValue: '实时流量' })}</Text>
					<ChartContainer
						className="mt-2 h-[220px]"
						config={{
							in: { label: t('forward.trafficIn', { defaultValue: '入口' }), color: 'var(--chart-1)' },
							out: { label: t('forward.trafficOut', { defaultValue: '出口' }), color: 'var(--chart-2)' }
						}}>
						<LineChart data={chartData}>
							<CartesianGrid strokeDasharray="3 3" />
							<XAxis dataKey="time" />
							<YAxis />
							<ChartTooltip content={<ChartTooltipContent />} />
							<Line type="monotone" dataKey="in" stroke="var(--color-chart-1)" dot={false} />
							<Line type="monotone" dataKey="out" stroke="var(--color-chart-2)" dot={false} />
						</LineChart>
					</ChartContainer>
				</Card>
				<Card>
					<Text weight="bold">{t('forward.latency', { defaultValue: '节点延迟' })}</Text>
					<ChartContainer
						className="mt-2 h-[220px]"
						config={{
							latency: { label: t('forward.latency', { defaultValue: '延迟' }), color: 'var(--chart-3)' }
						}}>
						<BarChart data={latencyData}>
							<CartesianGrid strokeDasharray="3 3" />
							<XAxis dataKey="name" />
							<YAxis />
							<Tooltip />
							<Bar dataKey="latency" fill="var(--color-chart-3)" />
						</BarChart>
					</ChartContainer>
				</Card>
			</Grid>

			<Grid columns="2" gap="4">
				<Card>
					<Text weight="bold">{t('forward.nodeHealth', { defaultValue: '节点健康状态' })}</Text>
					<div className="mt-3 space-y-2">
						{stats.map(stat => (
							<Flex key={stat.node_id} justify="between" align="center" className="border-b border-(--gray-4) pb-2">
								<Text>{stat.node_id}</Text>
								<Badge color={statusColor(stat.link_status)}>{stat.link_status}</Badge>
							</Flex>
						))}
					</div>
				</Card>
				<Card>
					<Text weight="bold">{t('forward.alertHistory', { defaultValue: '告警历史' })}</Text>
					<div className="mt-3 space-y-2">
						{alerts.length === 0 ? (
							<Text size="2" color="gray">
								{t('forward.noAlert', { defaultValue: '暂无告警' })}
							</Text>
						) : (
							alerts.map(item => (
								<Flex key={item.id} justify="between" align="center" className="border-b border-(--gray-4) pb-2">
									<div>
										<Text>{item.message}</Text>
										<Text size="1" color="gray">
											{item.created_at}
										</Text>
									</div>
									{item.acknowledged ? (
										<Badge color="green">{t('forward.acknowledged', { defaultValue: '已确认' })}</Badge>
									) : (
										<Button size="1" variant="soft" onClick={() => ackAlert(item.id)}>
											{t('forward.acknowledge', { defaultValue: '确认' })}
										</Button>
									)}
								</Flex>
							))
						)}
					</div>
				</Card>
			</Grid>
		</Flex>
	)
}

function parseLatency(raw?: string) {
	if (!raw) return 0
	try {
		const data = JSON.parse(raw)
		if (data.self !== undefined) return data.self
		const values = Object.values(data)
		return values.length ? Number(values[0]) : 0
	} catch {
		return 0
	}
}

export default ForwardDashboard
