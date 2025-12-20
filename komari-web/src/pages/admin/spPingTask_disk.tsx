import NodeSelectorDialog from '@/components/NodeSelectorDialog'
import { useSPPingTask } from '@/contexts/SPPingTaskContext'
import { useNodeDetails } from '@/contexts/NodeDetailsContext'
import { buildDefaultSPTaskForm, type SPTaskFormState } from '@/pages/admin/spPingTask_Form'
import { Button, Dialog, Flex, RadioGroup, SegmentedControl, Select, Text, TextField } from '@radix-ui/themes'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { buildDefaultTarget, getPreferredNodeIP, normalizeGroupKey, type TaskProbeType } from '@/utils/taskTarget'
import Flag from '@/components/Flag'
import { compareServersByWeightName } from '@/utils/serverSort'

export const AddButton: React.FC<{
	preset?: {
		name?: string
		target?: string
		type?: 'icmp' | 'tcp' | 'http'
		clients?: string[]
		step?: number
		pings?: number
		timeout_ms?: number
		payload_size?: number
	}
	children?: React.ReactNode
}> = ({ preset, children }) => {
	const { t } = useTranslation()
	const [isOpen, setIsOpen] = React.useState(false)
	const { nodeDetail } = useNodeDetails()
	const [form, setForm] = React.useState<SPTaskFormState>(buildDefaultSPTaskForm(preset as Partial<SPTaskFormState>))
	const [saving, setSaving] = React.useState(false)
	const { refresh } = useSPPingTask()

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

	const nodesInSelectedGroup = React.useMemo(() => nodeDetail.filter(n => normalizeGroupKey(n.group) === selectedGroup), [nodeDetail, selectedGroup])
	const selectedNode = React.useMemo(() => nodeDetail.find(n => n.uuid === selectedNodeUuid) || null, [nodeDetail, selectedNodeUuid])
	const selectedNodeIP = React.useMemo(() => (selectedNode ? getPreferredNodeIP(selectedNode) : ''), [selectedNode])
	const selectedNodeAutoTarget = React.useMemo(
		() => (selectedNodeIP ? buildDefaultTarget(selectedNodeIP, form.type as TaskProbeType) : ''),
		[selectedNodeIP, form.type]
	)
	const [nodeTarget, setNodeTarget] = React.useState('')

	React.useEffect(() => {
		if (preset) {
			setForm(buildDefaultSPTaskForm(preset as Partial<SPTaskFormState>))
		}
	}, [preset])

	React.useEffect(() => {
		if (isOpen) {
			setForm(buildDefaultSPTaskForm(preset as Partial<SPTaskFormState>))
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
		if (form.type === 'icmp') return
		const next: Record<string, string> = {}
		for (const n of nodesInSelectedGroup) {
			const ip = getPreferredNodeIP(n)
			if (!ip) continue
			next[n.uuid] = buildDefaultTarget(ip, form.type as TaskProbeType)
		}
		setGroupTargets(next)
	}, [targetSource, selectedGroup, form.type, nodesInSelectedGroup])

	const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault()
		if (!Array.isArray(form.clients) || form.clients.length === 0) {
			toast.error(t('spPing.select_clients', { defaultValue: '请先选择需要执行探测的节点' }))
			return
		}
		const base = {
			type: form.type,
			clients: form.clients,
			step: form.step,
			pings: form.pings,
			timeout_ms: form.timeout_ms,
			payload_size: form.payload_size
		}
		let payload: any = null
		if (targetSource === 'custom') {
			const trimmedName = form.name.trim()
			const trimmedTarget = form.target.trim()
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
							form.type === 'icmp'
								? buildDefaultTarget(ip, 'icmp')
								: (groupTargets[n.uuid] || buildDefaultTarget(ip, form.type as TaskProbeType)).trim()
					}
				})
				.filter(
					(v): v is {
						name: string
						target: string
						type: SPTaskFormState['type']
						clients: string[]
						step: number
						pings: number
						timeout_ms: number
						payload_size: number
					} => v !== null
				)
			if (tasksPayload.length === 0) {
				toast.error(t('common.error', { defaultValue: '错误' }))
				return
			}
			if (form.type !== 'icmp' && tasksPayload.some(task => !String(task.target || '').trim())) {
				toast.error(t('common.empty_error', { defaultValue: '不能为空' }))
				return
			}
			payload = { tasks: tasksPayload }
		}

		setSaving(true)
		fetch('/api/admin/sp-ping/add', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload)
		})
			.then(response => {
				if (response.ok) {
					setIsOpen(false)
					setForm(buildDefaultSPTaskForm())
					toast.success(t('common.success'))
				} else {
					return response.json().then(data => {
						throw new Error(data?.message || t('common.error'))
					})
				}
			})
			.catch(error => toast.error(error.message))
			.finally(() => {
				setSaving(false)
				refresh()
			})
	}

	return (
		<Dialog.Root open={isOpen} onOpenChange={setIsOpen}>
			<Dialog.Trigger>{children ? children : <Button>{t('common.add')}</Button>}</Dialog.Trigger>
			<Dialog.Content style={{ maxWidth: 520, maxHeight: '80vh', overflow: 'auto' }}>
				<Dialog.Title>{t('spPing.add')}</Dialog.Title>
				<form onSubmit={handleSubmit} className="flex flex-col gap-4">
					{/* 目标来源选择 */}
					<div className="flex flex-col gap-2">
						<Text as="label" size="2" weight="medium">
							{t('spPing.target_source', { defaultValue: '目标来源' })}
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
							{t('spPing.type')}
						</Text>
						<RadioGroup.Root
							value={form.type}
							onValueChange={value => setForm(prev => ({ ...prev, type: value as 'icmp' | 'tcp' | 'http' }))}
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
								name="name"
								autoComplete="off"
								placeholder={t('spPing.name_placeholder', { defaultValue: '例如：Cloudflare DNS' })}
								value={form.name}
								onChange={ev => setForm(prev => ({ ...prev, name: ev.currentTarget.value }))}
								required
							/>
						</div>
					)}

					{/* 自定义模式 - 目标 */}
					{targetSource === 'custom' && (
						<div className="flex flex-col gap-2">
							<Text as="label" size="2" weight="medium">
								{t('spPing.target')}
							</Text>
							<TextField.Root
								name="target"
								autoComplete="off"
								placeholder={form.type === 'icmp' ? '1.1.1.1' : form.type === 'tcp' ? '1.1.1.1:22' : 'https://1.1.1.1'}
								value={form.target}
								onChange={ev => setForm(prev => ({ ...prev, target: ev.currentTarget.value }))}
								required
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
									{t('spPing.target')}
								</Text>
								<TextField.Root value={nodeTarget} onChange={e => setNodeTarget(e.currentTarget.value)} required autoComplete="off" />
							</div>
						</>
					)}

					{/* 分组模式 - 目标列表 */}
					{targetSource === 'group' && (
						<div className="flex flex-col gap-2">
							<Text as="label" size="2" weight="medium">
								{t('spPing.target')}
							</Text>
							{form.type === 'icmp' ? (
								<div className="text-sm text-(--gray-11) bg-(--gray-a3) rounded-2 px-3 py-2">
									{t('spPing.group_add_hint', {
										defaultValue: '将为该分组内所有节点创建任务，名称为节点名，目标为节点 IP。',
										count: nodesInSelectedGroup.length
									})}
								</div>
							) : (
								<div className="flex flex-col gap-2 max-h-[28vh] overflow-y-auto rounded-2 border border-(--gray-a5) p-3 bg-(--gray-a2)">
									{nodesInSelectedGroup.map(n => {
										const ip = getPreferredNodeIP(n)
										if (!ip) return null
										const defaultTarget = buildDefaultTarget(ip, form.type as TaskProbeType)
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

					{/* 高级参数 */}
					<div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
						<div className="flex flex-col gap-2">
							<Text as="label" size="2" weight="medium">
								{t('spPing.step')} (s)
							</Text>
							<TextField.Root
								name="step"
								type="number"
								min={10}
								value={form.step}
								onChange={ev => setForm(prev => ({ ...prev, step: parseInt(ev.currentTarget.value || '0', 10) || 0 }))}
								required
								autoComplete="off"
							/>
						</div>
						<div className="flex flex-col gap-2">
							<Text as="label" size="2" weight="medium">
								{t('spPing.pings')}
							</Text>
							<TextField.Root
								name="pings"
								type="number"
								min={3}
								value={form.pings}
								onChange={ev => setForm(prev => ({ ...prev, pings: parseInt(ev.currentTarget.value || '0', 10) || 0 }))}
								required
								autoComplete="off"
							/>
						</div>
						<div className="flex flex-col gap-2">
							<Text as="label" size="2" weight="medium">
								{t('spPing.timeout')} (ms)
							</Text>
							<TextField.Root
								name="timeout_ms"
								type="number"
								min={500}
								value={form.timeout_ms}
								onChange={ev => setForm(prev => ({ ...prev, timeout_ms: parseInt(ev.currentTarget.value || '0', 10) || 0 }))}
								required
								autoComplete="off"
							/>
						</div>
						<div className="flex flex-col gap-2">
							<Text as="label" size="2" weight="medium">
								{t('spPing.payload_size')}
							</Text>
							<TextField.Root
								name="payload_size"
								type="number"
								min={16}
								max={1500}
								value={form.payload_size}
								onChange={ev => setForm(prev => ({ ...prev, payload_size: parseInt(ev.currentTarget.value || '0', 10) || 0 }))}
								required
								autoComplete="off"
							/>
						</div>
					</div>

					{/* 执行节点 */}
					<div className="flex flex-col gap-2">
						<Text as="label" size="2" weight="medium">
							{t('common.server')}
						</Text>
						<Flex align="center" gap="3">
							<NodeSelectorDialog value={form.clients} onChange={v => setForm(prev => ({ ...prev, clients: v }))} showViewModeToggle />
							<Text size="2" color="gray">
								{t('common.selected', { count: form.clients.length })}
							</Text>
						</Flex>
					</div>

					{/* 说明信息 */}
					<div className="text-sm text-(--gray-11) bg-(--gray-a3) rounded-2 px-3 py-2">{t('spPing.how_it_works')}</div>

					{/* 底部操作按钮 */}
					<Flex gap="3" justify="end" pt="2">
						<Dialog.Close>
							<Button variant="soft" color="gray" type="button">
								{t('common.cancel')}
							</Button>
						</Dialog.Close>
						<Button type="submit" disabled={saving}>
							{t('common.save')}
						</Button>
					</Flex>
				</form>
			</Dialog.Content>
		</Dialog.Root>
	)
}
