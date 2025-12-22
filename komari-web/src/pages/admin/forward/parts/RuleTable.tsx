import { ForwardRule } from '..'
import { Badge, Button, Checkbox, DropdownMenu, Flex, IconButton, Switch, Table, Text } from '@radix-ui/themes'
import { DotsHorizontalIcon, EyeOpenIcon, Pencil1Icon, RocketIcon, StopIcon } from '@radix-ui/react-icons'
import { BarChart3, GripVertical } from 'lucide-react'
import { DndContext, KeyboardSensor, MouseSensor, TouchSensor, closestCenter, type DragEndEvent, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useTranslation } from 'react-i18next'
import { useNodeDetails } from '@/contexts/NodeDetailsContext'

type Props = {
	rules: ForwardRule[]
	onView: (rule: ForwardRule) => void
	onEdit: (rule: ForwardRule) => void
	onStart: (id: number) => void
	onStop: (id: number) => void
	onToggleEnable: (id: number, nextEnabled: boolean) => void
	onMonitor: (id: number) => void
	onTest: (rule: ForwardRule) => void
	onLogs: (rule: ForwardRule) => void
	onDelete: (rule: ForwardRule) => void
	onExport: (rule: ForwardRule) => void
	draggable?: boolean
	onReorder?: (rules: ForwardRule[]) => void
	selectedIds?: number[]
	onToggleSelect?: (id: number, checked: boolean) => void
	onToggleSelectAll?: (checked: boolean) => void
}

const RuleTable = ({
	rules,
	onView,
	onEdit,
	onStart,
	onStop,
	onToggleEnable,
	onMonitor,
	onTest,
	onLogs,
	onDelete,
	onExport,
	draggable = false,
	onReorder,
	selectedIds = [],
	onToggleSelect,
	onToggleSelectAll
}: Props) => {
	const { t } = useTranslation()
	const { nodeDetail } = useNodeDetails()
	const sensors = useSensors(
		useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
		useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
		useSensor(KeyboardSensor, {})
	)
	const statusColor = (status: string) => {
		const s = status?.toLowerCase()
		if (s === 'running') return 'green'
		if (s === 'error') return 'red'
		return 'gray'
	}
	const statusLabel = (status: string) => {
		const s = status?.toLowerCase()
		if (s === 'running') return t('forward.statusRunning', { defaultValue: '运行中' })
		if (s === 'error') return t('forward.statusError', { defaultValue: '异常' })
		return t('forward.statusStopped', { defaultValue: '已停止' })
	}
	const typeBadge = (type?: string) => {
		const tVal = (type || '').toLowerCase()
		if (tVal === 'direct') return { label: t('forward.typeDirect', { defaultValue: '中转' }), color: 'blue' }
		if (tVal === 'relay_group') return { label: t('forward.typeRelayGroup', { defaultValue: '中继组' }), color: 'teal' }
		if (tVal === 'chain') return { label: t('forward.typeChain', { defaultValue: '链式' }), color: 'orange' }
		return { label: type || '-', color: 'gray' }
	}
	const nodeName = (id?: string) => {
		if (!id) return '-'
		return nodeDetail.find(n => n.uuid === id)?.name || id
	}
	const formatPort = (port?: number | string) => {
		if (port === undefined || port === null || port === '') return '-'
		return String(port)
	}
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
	const parseConfig = (configJson?: string) => {
		if (!configJson) return null
		try {
			return JSON.parse(configJson)
		} catch {
			return null
		}
	}
	const allChecked = rules.length > 0 && rules.every(r => selectedIds.includes(r.id))

	const handleDragEnd = (event: DragEndEvent) => {
		if (!onReorder) return
		const { active, over } = event
		if (!over || active.id === over.id) return
		const oldIndex = rules.findIndex(rule => String(rule.id) === String(active.id))
		const newIndex = rules.findIndex(rule => String(rule.id) === String(over.id))
		if (oldIndex === -1 || newIndex === -1) return
		const reordered = arrayMove(rules, oldIndex, newIndex)
		onReorder(reordered)
	}

	const Row = draggable ? SortableRow : PlainRow
	const renderDragHandle = () =>
		draggable ? (
			<IconButton size="1" variant="ghost">
				<GripVertical size={14} />
			</IconButton>
		) : (
			<span className="inline-block w-4" />
		)

	const table = (
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.ColumnHeaderCell className="w-8" />
					<Table.ColumnHeaderCell className="w-8">
						<Checkbox checked={allChecked} onCheckedChange={v => onToggleSelectAll?.(Boolean(v))} />
					</Table.ColumnHeaderCell>
					<Table.ColumnHeaderCell>{t('forward.status')}</Table.ColumnHeaderCell>
					<Table.ColumnHeaderCell>{t('forward.name')}</Table.ColumnHeaderCell>
					<Table.ColumnHeaderCell>{t('forward.type')}</Table.ColumnHeaderCell>
					<Table.ColumnHeaderCell>{t('forward.entry')}</Table.ColumnHeaderCell>
					<Table.ColumnHeaderCell>{t('forward.target')}</Table.ColumnHeaderCell>
					<Table.ColumnHeaderCell>{t('chart.connections')}</Table.ColumnHeaderCell>
					<Table.ColumnHeaderCell>{t('common.traffic', { defaultValue: '流量' })}</Table.ColumnHeaderCell>
					<Table.ColumnHeaderCell>{t('forward.actions')}</Table.ColumnHeaderCell>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{rules.map(rule => {
					const cfg = parseConfig(rule.config_json)
					const entryPort = cfg?.entry_current_port || cfg?.entry_port
					const entryLabel = cfg?.entry_node_id ? `${nodeName(cfg.entry_node_id)}:${formatPort(entryPort)}` : '-'
					const targetLabel =
						cfg?.target_type === 'node'
							? `${nodeName(cfg.target_node_id)}:${formatPort(cfg?.target_port)}`
							: cfg?.target_host
								? `${cfg?.target_host}:${formatPort(cfg?.target_port)}`
								: '-'
					const activeRelay =
						cfg?.strategy === 'priority' && cfg?.active_relay_node_id ? nodeName(cfg.active_relay_node_id) : ''
					return (
						<Row
							key={rule.id}
							rule={rule}
							dragHandle={renderDragHandle()}>
							<Table.Cell>
								<Checkbox checked={selectedIds.includes(rule.id)} onCheckedChange={v => onToggleSelect?.(rule.id, Boolean(v))} />
							</Table.Cell>
							<Table.Cell>
								<Flex gap="2" align="center">
									<Badge color={statusColor(rule.status)}>{statusLabel(rule.status)}</Badge>
								</Flex>
							</Table.Cell>
							<Table.Cell>
								<Button variant="ghost" size="1" onClick={() => onMonitor(rule.id)}>
									{rule.name || '-'}
								</Button>
							</Table.Cell>
							<Table.Cell>
								{(() => {
									const badge = typeBadge(rule.type)
									return <Badge color={badge.color as any}>{badge.label}</Badge>
								})()}
							</Table.Cell>
							<Table.Cell>
								<Text>{entryLabel}</Text>
							</Table.Cell>
							<Table.Cell>
								<Flex direction="column" gap="1">
									<Text>{targetLabel}</Text>
									{activeRelay && (
										<Text size="1" color="gray">
											{t('forward.activeRelay')}: {activeRelay}
										</Text>
									)}
								</Flex>
							</Table.Cell>
							<Table.Cell>
								<Text>{rule.total_connections ?? 0}</Text>
							</Table.Cell>
							<Table.Cell>
								<Text>
									{formatBytes(rule.total_traffic_in)} / {formatBytes(rule.total_traffic_out)}
								</Text>
							</Table.Cell>
							<Table.Cell>
								<Flex gap="2" align="center">
									<IconButton size="1" variant="soft" onClick={() => onView(rule)} title={t('forward.viewDetail')}>
										<EyeOpenIcon />
									</IconButton>
									<IconButton size="1" variant="soft" onClick={() => onMonitor(rule.id)} title={t('forward.monitor')}>
										<BarChart3 size={14} />
									</IconButton>
									<IconButton size="1" variant="soft" onClick={() => onEdit(rule)} title={t('forward.edit')}>
										<Pencil1Icon />
									</IconButton>
									<IconButton size="1" variant="surface" color="green" onClick={() => onStart(rule.id)} title={t('forward.start')}>
										<RocketIcon />
									</IconButton>
									<IconButton size="1" variant="surface" color="red" onClick={() => onStop(rule.id)} title={t('forward.stop')}>
										<StopIcon />
									</IconButton>
									<Switch checked={rule.is_enabled} onCheckedChange={v => onToggleEnable(rule.id, Boolean(v))} />
									<DropdownMenu.Root>
										<DropdownMenu.Trigger>
											<IconButton size="1" variant="ghost">
												<DotsHorizontalIcon />
											</IconButton>
										</DropdownMenu.Trigger>
										<DropdownMenu.Content>
											<DropdownMenu.Item onSelect={() => onExport(rule)}>{t('forward.exportConfig')}</DropdownMenu.Item>
											<DropdownMenu.Item onSelect={() => onTest(rule)}>{t('forward.testConnectivity')}</DropdownMenu.Item>
											<DropdownMenu.Item onSelect={() => onLogs(rule)}>{t('forward.logs')}</DropdownMenu.Item>
											<DropdownMenu.Separator />
											<DropdownMenu.Item color="red" onSelect={() => onDelete(rule)}>
												{t('forward.delete')}
											</DropdownMenu.Item>
										</DropdownMenu.Content>
									</DropdownMenu.Root>
								</Flex>
							</Table.Cell>
						</Row>
					)
				})}
			</Table.Body>
		</Table.Root>
	)

	return draggable ? (
		<DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
			<SortableContext items={rules.map(rule => String(rule.id))} strategy={verticalListSortingStrategy}>
				{table}
			</SortableContext>
		</DndContext>
	) : (
		table
	)
}

export default RuleTable

const PlainRow = ({
	children,
	dragHandle
}: {
	children: React.ReactNode
	dragHandle: React.ReactNode
	rule: ForwardRule
}) => {
	return (
		<Table.Row>
			<Table.Cell className="w-8">{dragHandle}</Table.Cell>
			{children}
		</Table.Row>
	)
}

const SortableRow = ({
	children,
	rule,
	dragHandle
}: {
	children: React.ReactNode
	rule: ForwardRule
	dragHandle: React.ReactNode
}) => {
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: String(rule.id) })
	const style = {
		transform: CSS.Transform.toString(transform),
		transition
	}
	return (
		<Table.Row ref={setNodeRef} style={style} className={isDragging ? 'opacity-60' : ''}>
			<Table.Cell className="w-8">
				<span {...attributes} {...listeners}>
					{dragHandle}
				</span>
			</Table.Cell>
			{children}
		</Table.Row>
	)
}
