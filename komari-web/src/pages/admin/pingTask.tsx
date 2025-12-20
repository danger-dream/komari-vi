import Loading from '@/components/loading'
import NodeSelectorDialog from '@/components/NodeSelectorDialog'
import { NodeDetailsProvider, useNodeDetails } from '@/contexts/NodeDetailsContext'
import { PingTaskProvider, usePingTask, type PingTask } from '@/contexts/PingTaskContext'
import { useSettings } from '@/lib/api'
import { Box, Button, Checkbox, Dialog, Flex, RadioGroup, Select, Tabs, Text, TextField } from '@radix-ui/themes'
import { SegmentedControl } from '@radix-ui/themes'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { TaskView } from './pingTask_Task'
import { ServerView } from './pingTask_Server'
import { buildDefaultTarget, getPreferredNodeIP, normalizeGroupKey, type TaskProbeType } from '@/utils/taskTarget'
import Flag from '@/components/Flag'
import { compareServersByWeightName } from '@/utils/serverSort'

const PingTask = () => {
	return (
		<PingTaskProvider>
			<NodeDetailsProvider>
				<InnerLayout />
			</NodeDetailsProvider>
		</PingTaskProvider>
	)
}

const InnerLayout = () => {
	const { pingTasks, isLoading, error } = usePingTask()
	const { isLoading: nodeDetailLoading, error: nodeDetailError } = useNodeDetails()
	const { t } = useTranslation()
	const [privacyMode, setPrivacyMode] = React.useState(false)

	if (isLoading || nodeDetailLoading) {
		return <Loading />
	}
	if (error || nodeDetailError) {
		return <div>{error || nodeDetailError}</div>
	}
	return (
		<Flex direction="column" gap="4" className="p-4">
			<div className="flex justify-between items-center">
				<label className="text-2xl font-bold">{t('ping.title')}</label>
				<Flex gap="2">
					<Text as="label" size="2" className="flex items-center gap-2 cursor-pointer select-none">
						<Checkbox checked={privacyMode} onCheckedChange={checked => setPrivacyMode(Boolean(checked))} />
						{t('admin.nodeTable.privacyMode', '隐私模式')}
					</Text>
					<AddButton />
					<Button
						variant="outline"
						color="red"
						onClick={() => {
							if (!confirm(t('ping.clear_confirm', { defaultValue: '确定清空所有延迟检测历史数据？' }))) return
							fetch('/api/admin/ping/clear', { method: 'POST' })
								.then(res => {
									if (!res.ok) throw new Error(t('common.error'))
									return res.json()
								})
								.then(() => toast.success(t('common.success')))
								.catch(err => toast.error(err.message || t('common.error')))
						}}>
						{t('ping.clear', { defaultValue: '清空数据' })}
					</Button>
				</Flex>
			</div>
			<Tabs.Root defaultValue="task">
				<Tabs.List>
					<Tabs.Trigger value="task">{t('ping.task_view')}</Tabs.Trigger>
					<Tabs.Trigger value="server">{t('ping.server_view')}</Tabs.Trigger>
				</Tabs.List>
				<Box pt="3">
					<Tabs.Content value="task">
						<TaskView pingTasks={pingTasks ?? []} privacyMode={privacyMode} />
					</Tabs.Content>
					<Tabs.Content value="server">
						<ServerView pingTasks={pingTasks ?? []} />
					</Tabs.Content>
				</Box>
			</Tabs.Root>
			<DiskUsageEstimate />
		</Flex>
	)
}

const DiskUsageEstimate = () => {
	const { pingTasks } = usePingTask()
	const { t } = useTranslation()

	// 计算预估磁盘消耗
	const calculateDiskUsage = () => {
		if (!pingTasks || pingTasks.length === 0) return 0

		// 一条记录的大小估算：
		// - uuid: 36字节 (UUID字符串)
		// - int: 8字节 (64位整数)
		// - int: 8字节 (64位整数)
		// - time: 33字节 (RFC3339格式字符串，如 "2006-01-02T15:04:05.000Z07:00")
		// - 其他开销: 20字节
		const recordSize = (36 + 8 + 8 + 33 + 20) * 2 // 回收余量2倍

		const totalRecordsPerDay = pingTasks.reduce((total, task) => {
			const clientCount = task.clients?.length || 0
			const interval = task.interval || 60 // 默认60秒
			const recordsPerDay = (clientCount * (24 * 60 * 60)) / interval
			return total + recordsPerDay
		}, 0)

		return totalRecordsPerDay * recordSize
	}

	// 格式化文件大小
	const formatBytes = (bytes: number) => {
		if (bytes === 0) return '0 B'
		const k = 1024
		const sizes = ['B', 'KB', 'MB', 'GB']
		const i = Math.floor(Math.log(bytes) / Math.log(k))
		return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
	}
	const { settings } = useSettings()

	const dailyUsage = calculateDiskUsage()
	//const monthlyUsage = dailyUsage * 31;
	//const yearlyUsage = dailyUsage * 365;

	return (
		<div className="text-sm text-muted-foreground">
			<label>
				{t('ping.disk_usage_estimate')}: {formatBytes(dailyUsage)}/{t('common.day')},{' '}
				{t('ping.disk_usage_with_settings', {
					hour: settings.ping_record_preserve_time,
					space: formatBytes((dailyUsage * settings.ping_record_preserve_time) / 24)
				})}
			</label>
		</div>
	)
}

export const AddButton: React.FC<{
	preset?: {
		name?: string
		target?: string
		type?: 'icmp' | 'tcp' | 'http'
		clients?: string[]
		interval?: number
	}
	children?: React.ReactNode
}> = ({ preset, children }) => {
	const { t } = useTranslation()
	const [isOpen, setIsOpen] = React.useState(false)
	const { nodeDetail } = useNodeDetails()
	const [selected, setSelected] = React.useState<string[]>([])
	const { refresh } = usePingTask()
	const [selectedType, setSelectedType] = React.useState<TaskProbeType>(preset?.type ?? 'icmp')
	const [saving, setSaving] = React.useState(false)
	const [name, setName] = React.useState(preset?.name ?? '')
	const [target, setTarget] = React.useState(preset?.target ?? '')
	const [interval, setInterval] = React.useState<number>(preset?.interval ?? 30)

	const [targetSource, setTargetSource] = React.useState<'custom' | 'node' | 'group'>('custom')
	const [selectedNodeUuid, setSelectedNodeUuid] = React.useState<string>('')
	const [nodeName, setNodeName] = React.useState('')
	const [selectedGroup, setSelectedGroup] = React.useState<string>('__ungrouped__')
	const [groupTargets, setGroupTargets] = React.useState<Record<string, string>>({})

	const groups = React.useMemo(() => {
		const set = new Set<string>(['__ungrouped__'])
		for (const n of nodeDetail) set.add(normalizeGroupKey(n.group))
		const list = Array.from(set).filter(g => g !== '__ungrouped__')
		list.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
		return ['__ungrouped__', ...list]
	}, [nodeDetail])

	const sortedNodes = React.useMemo(() => [...nodeDetail].sort(compareServersByWeightName), [nodeDetail])

	const nodesInSelectedGroup = React.useMemo(() => {
		return nodeDetail.filter(n => normalizeGroupKey(n.group) === selectedGroup)
	}, [nodeDetail, selectedGroup])

	const selectedNode = React.useMemo(() => nodeDetail.find(n => n.uuid === selectedNodeUuid) || null, [nodeDetail, selectedNodeUuid])
	const selectedNodeIP = React.useMemo(() => (selectedNode ? getPreferredNodeIP(selectedNode) : ''), [selectedNode])
	const selectedNodeAutoTarget = React.useMemo(
		() => (selectedNodeIP ? buildDefaultTarget(selectedNodeIP, selectedType) : ''),
		[selectedNodeIP, selectedType]
	)
	const [nodeTarget, setNodeTarget] = React.useState('')

	React.useEffect(() => {
		if (preset) {
			setName(preset.name ?? '')
			setTarget(preset.target ?? '')
			setInterval(preset.interval ?? 30)
			setSelectedType(preset.type ?? 'icmp')
			setSelected(preset.clients ?? [])
		}
	}, [preset])

	React.useEffect(() => {
		if (isOpen) {
			setSelected(preset?.clients ?? [])
			setSelectedType(preset?.type ?? 'icmp')
			setName(preset?.name ?? '')
			setTarget(preset?.target ?? '')
			setInterval(preset?.interval ?? 30)
			setTargetSource('custom')
			setSelectedNodeUuid('')
			setNodeName('')
			setSelectedGroup(groups[0] ?? '__ungrouped__')
			setGroupTargets({})
			setNodeTarget('')
		}
	}, [isOpen, preset, groups])

	React.useEffect(() => {
		if (targetSource !== 'node') return
		if (!selectedNode) {
			setNodeName('')
			return
		}
		setNodeName((selectedNode.name || selectedNode.uuid).trim())
	}, [targetSource, selectedNode])

	React.useEffect(() => {
		if (targetSource !== 'node') return
		setNodeTarget(selectedNodeAutoTarget)
	}, [targetSource, selectedNodeAutoTarget])

	React.useEffect(() => {
		if (targetSource !== 'group') return
		if (selectedType === 'icmp') return
		const next: Record<string, string> = {}
		for (const n of nodesInSelectedGroup) {
			const ip = getPreferredNodeIP(n)
			if (!ip) continue
			next[n.uuid] = buildDefaultTarget(ip, selectedType)
		}
		setGroupTargets(next)
	}, [targetSource, selectedGroup, selectedType, nodesInSelectedGroup])

	const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault()
		if (selected.length === 0) {
			toast.error(t('ping.select_clients', { defaultValue: '请先选择需要执行探测的节点' }))
			return
		}
		const base = {
			type: selectedType,
			clients: selected,
			interval
		}
		let payload: any = null
		if (targetSource === 'custom') {
			const trimmedName = name.trim()
			const trimmedTarget = target.trim()
			if (!trimmedName || !trimmedTarget) {
				toast.error(t('common.empty_error', { defaultValue: '不能为空' }))
				return
			}
			payload = { ...base, name: trimmedName, target: trimmedTarget }
		} else if (targetSource === 'node') {
			if (!selectedNode || !selectedNodeIP || !selectedNodeAutoTarget) {
				toast.error(t('common.select', { defaultValue: '请选择' }))
				return
			}
			const trimmedNodeName = nodeName.trim()
			const trimmedNodeTarget = nodeTarget.trim()
			if (!trimmedNodeName || !trimmedNodeTarget) {
				toast.error(t('common.empty_error', { defaultValue: '不能为空' }))
				return
			}
			payload = { ...base, name: trimmedNodeName, target: trimmedNodeTarget }
		} else {
			const tasksPayload = nodesInSelectedGroup
				.map(n => {
					const ip = getPreferredNodeIP(n)
					if (!ip) return null
					return {
						...base,
						name: (n.name || n.uuid).trim(),
						target:
							selectedType === 'icmp'
								? buildDefaultTarget(ip, 'icmp')
								: (groupTargets[n.uuid] || buildDefaultTarget(ip, selectedType)).trim()
					}
				})
				.filter((v): v is { name: string; target: string; type: TaskProbeType; clients: string[]; interval: number } => v !== null)
			if (tasksPayload.length === 0) {
				toast.error(t('common.error', { defaultValue: '错误' }))
				return
			}
			if (selectedType !== 'icmp' && tasksPayload.some(task => !String(task.target || '').trim())) {
				toast.error(t('common.empty_error', { defaultValue: '不能为空' }))
				return
			}
			payload = { tasks: tasksPayload }
		}

		setSaving(true)
		fetch('/api/admin/ping/add', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(payload)
		})
			.then(response => {
				if (response.ok) {
					setIsOpen(false)
					setSelected([])
					setSelectedType('icmp')
					toast.success(t('common.success'))
				} else {
					response
						.json()
						.then(data => {
							toast.error(data?.message || t('common.error'))
						})
						.catch(error => {
							toast.error(error.message)
						})
				}
			})
			.catch(error => {
				console.error('Error adding ping task:', error)
				toast.error(error.message)
			})
			.finally(() => {
				setSaving(false)
				refresh()
			})
	}
	return (
		<Dialog.Root open={isOpen} onOpenChange={setIsOpen}>
			<Dialog.Trigger>
				{children ? React.isValidElement(children) ? children : <Button>{t('common.add')}</Button> : <Button>{t('common.add')}</Button>}
			</Dialog.Trigger>
			<Dialog.Content style={{ maxWidth: 480, maxHeight: '80vh', overflow: 'auto' }}>
				<Dialog.Title>{t('common.add')}</Dialog.Title>
				<form onSubmit={handleSubmit} className="flex flex-col gap-4">
					{/* 目标来源选择 */}
					<div className="flex flex-col gap-2">
						<Text as="label" size="2" weight="medium">
							{t('ping.target_source', { defaultValue: '目标来源' })}
						</Text>
						<SegmentedControl.Root value={targetSource} onValueChange={v => setTargetSource(v as any)} size="2">
							<SegmentedControl.Item value="custom">{t('common.custom')}</SegmentedControl.Item>
							<SegmentedControl.Item value="node">{t('common.from_node', { defaultValue: '从节点' })}</SegmentedControl.Item>
							<SegmentedControl.Item value="group">{t('common.from_group', { defaultValue: '从分组' })}</SegmentedControl.Item>
						</SegmentedControl.Root>
					</div>

					{/* 节点选择 */}
					{targetSource === 'node' && (
						<div className="flex flex-col gap-2">
							<Text as="label" size="2" weight="medium">
								{t('common.select_node', { defaultValue: '选择节点' })}
							</Text>
							<Select.Root value={selectedNodeUuid} onValueChange={setSelectedNodeUuid}>
								<Select.Trigger placeholder={t('common.select', { defaultValue: '请选择节点' })} />
								<Select.Content position="popper">
									{sortedNodes.map(n => {
										const ip = getPreferredNodeIP(n)
										return (
											<Select.Item key={n.uuid} value={n.uuid} disabled={!ip}>
												<Flex align="center" gap="2" className="w-full">
													<Flag flag={n.region ?? ''} size="3" />
													<span className="flex-1 truncate">{n.name || n.uuid}</span>
													{ip ? <span className="text-(--gray-11) text-xs">{ip}</span> : null}
												</Flex>
											</Select.Item>
										)
									})}
								</Select.Content>
							</Select.Root>
						</div>
					)}

					{/* 分组选择 */}
					{targetSource === 'group' && (
						<div className="flex flex-col gap-2">
							<Text as="label" size="2" weight="medium">
								{t('common.select_group', { defaultValue: '选择分组' })}
							</Text>
							<Select.Root value={selectedGroup} onValueChange={setSelectedGroup}>
								<Select.Trigger placeholder={t('common.select', { defaultValue: '请选择分组' })} />
								<Select.Content position="popper">
									{groups.map(g => (
										<Select.Item key={g} value={g}>
											{g === '__ungrouped__' ? t('common.ungrouped', { defaultValue: '未分组' }) : g}
										</Select.Item>
									))}
								</Select.Content>
							</Select.Root>
						</div>
					)}

					{/* 检测类型 - 使用 RadioCards */}
					<div className="flex flex-col gap-2">
						<Text as="label" size="2" weight="medium">
							{t('ping.type')}
						</Text>
						<RadioGroup.Root
							value={selectedType}
							onValueChange={value => setSelectedType(value as 'icmp' | 'tcp' | 'http')}
							orientation="vertical"
							className="flex flex-wrap flex-row! gap-5!">
							<RadioGroup.Item value="icmp">ICMP</RadioGroup.Item>
							<RadioGroup.Item value="tcp">TCP</RadioGroup.Item>
							<RadioGroup.Item value="http">HTTP</RadioGroup.Item>
						</RadioGroup.Root>
					</div>

					{/* 自定义模式 - 名称 */}
					{targetSource === 'custom' && (
						<div className="flex flex-col gap-2">
							<Text as="label" size="2" weight="medium">
								{t('common.name')}
							</Text>
							<TextField.Root
								id="ping_name"
								name="ping_name"
								autoComplete="off"
								placeholder={t('ping.name_placeholder', { defaultValue: '例如：Cloudflare DNS' })}
								value={name}
								onChange={e => setName(e.currentTarget.value)}
								required
							/>
						</div>
					)}

					{/* 自定义模式 - 目标 */}
					{targetSource === 'custom' && (
						<div className="flex flex-col gap-2">
							<Text as="label" size="2" weight="medium">
								{t('ping.target')}
							</Text>
							<TextField.Root
								id="ping_target"
								name="ping_target"
								placeholder={selectedType === 'icmp' ? '1.1.1.1' : selectedType === 'tcp' ? '1.1.1.1:22' : 'https://1.1.1.1'}
								value={target}
								onChange={e => setTarget(e.currentTarget.value)}
								required
								autoComplete="off"
							/>
						</div>
					)}

					{/* 节点模式 - 名称和目标 */}
					{targetSource === 'node' && (
						<>
							<div className="flex flex-col gap-2">
								<Text as="label" size="2" weight="medium">
									{t('common.name')}
								</Text>
								<TextField.Root
									value={nodeName}
									onChange={e => setNodeName(e.currentTarget.value)}
									placeholder={(selectedNode?.name || '').trim() || t('common.name')}
									required
									autoComplete="off"
								/>
							</div>
							<div className="flex flex-col gap-2">
								<Text as="label" size="2" weight="medium">
									{t('ping.target')}
								</Text>
								<TextField.Root value={nodeTarget} onChange={e => setNodeTarget(e.currentTarget.value)} required autoComplete="off" />
							</div>
						</>
					)}

					{/* 分组模式 - 目标列表 */}
					{targetSource === 'group' && (
						<div className="flex flex-col gap-2">
							<Text as="label" size="2" weight="medium">
								{t('ping.target')}
							</Text>
							{selectedType === 'icmp' ? (
								<div className="text-sm text-(--gray-11) bg-(--gray-a3) rounded-2 px-3 py-2">
									{t('ping.group_add_hint', {
										defaultValue: '将为该分组内所有节点创建任务，名称为节点名，目标为节点 IP。',
										count: nodesInSelectedGroup.length
									})}
								</div>
							) : (
								<div className="flex flex-col gap-2 max-h-[35vh] overflow-y-auto rounded-2 border border-(--gray-a5) p-3 bg-(--gray-a2)">
									{nodesInSelectedGroup.map(n => {
										const ip = getPreferredNodeIP(n)
										if (!ip) return null
										const defaultTarget = buildDefaultTarget(ip, selectedType)
										return (
											<div key={n.uuid} className="flex flex-col gap-1">
												<Text size="1" color="gray">
													{n.name} ({ip})
												</Text>
												<TextField.Root
													size="2"
													value={groupTargets[n.uuid] ?? ''}
													onChange={e => setGroupTargets(prev => ({ ...prev, [n.uuid]: e.currentTarget.value }))}
													placeholder={defaultTarget}
													required
													autoComplete="off"
												/>
											</div>
										)
									})}
								</div>
							)}
						</div>
					)}

					{/* 检测间隔 */}
					<div className="flex flex-col gap-2">
						<Text as="label" size="2" weight="medium">
							{t('ping.interval')} ({t('time.second')})
						</Text>
						<TextField.Root
							id="interval"
							name="interval"
							type="number"
							placeholder="30"
							value={interval}
							onChange={e => setInterval(parseInt(e.currentTarget.value || '0', 10) || 0)}
							required
							autoComplete="off"
						/>
					</div>

					{/* 执行节点 */}
					<div className="flex flex-col gap-2">
						<Text as="label" size="2" weight="medium">
							{t('common.server')}
						</Text>
						<Flex align="center" gap="3">
							<NodeSelectorDialog value={selected} onChange={setSelected} showViewModeToggle />
							<Text size="2" color="gray">
								{t('common.selected', { count: selected.length })}
							</Text>
						</Flex>
					</div>

					{/* 底部操作按钮 */}
					<Flex gap="3" justify="end" pt="2">
						<Dialog.Close>
							<Button variant="soft" color="gray">
								{t('common.close')}
							</Button>
						</Dialog.Close>
						<Button disabled={saving} type="submit">
							{t('common.add')}
						</Button>
					</Flex>
				</form>
			</Dialog.Content>
		</Dialog.Root>
	)
}

export default PingTask
