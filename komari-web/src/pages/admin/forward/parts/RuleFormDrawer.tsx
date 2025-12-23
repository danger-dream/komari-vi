import { Button, Flex, Select, Switch, Text, TextArea, TextField, RadioGroup } from '@radix-ui/themes'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Drawer, DrawerClose, DrawerContent, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import NodeSelectorDialog from '@/components/NodeSelectorDialog'
import { Server, Waypoints, Link2, ArrowRight, ArrowDown, Plus, Trash2, TestTube, Save, X, Network } from 'lucide-react'
import { useNodeDetails, type NodeDetail } from '@/contexts/NodeDetailsContext'
import TestConnectivityDialog from './TestConnectivityDialog'
import { useIsMobile } from '@/hooks/use-mobile'

export type RuleFormState = {
	id?: number
	name: string
	group_name: string
	tags: string
	notes: string
	type: string
	is_enabled: boolean
	config_json: string
}

type RelayForm = {
	node_id: string
	port: string
	sort_order: number
	current_port?: number
}

type HopForm =
	| { id: string; type: 'direct'; node_id: string; port: string; current_port?: number; sort_order?: number }
	| { id: string; type: 'relay_group'; relays: RelayForm[]; strategy: string; active_relay_node_id?: string }

type StructuredConfig = {
	entry_node_id: string
	entry_port: string
	entry_current_port?: number
	protocol: 'tcp' | 'udp' | 'both'
	target_type: 'custom' | 'node'
	target_node_id?: string
	target_host?: string
	target_port?: string
	relays: RelayForm[]
	strategy: string
	active_relay_node_id?: string
	hops: HopForm[]
}

type Props = {
	open: boolean
	initial: RuleFormState
	onClose: () => void
	onSubmit: (data: RuleFormState) => void
}

const uid = () => crypto?.randomUUID?.() || `hop-${Date.now()}-${Math.random().toString(16).slice(2)}`

const RuleFormDrawer = ({ open, initial, onClose, onSubmit }: Props) => {
	const { t } = useTranslation()
	const { nodeDetail } = useNodeDetails()
	const isMobile = useIsMobile()
	const [form, setForm] = useState<RuleFormState>(initial)
	const [saving, setSaving] = useState(false)
	const [mode, setMode] = useState<'structured' | 'raw'>('structured')
	const [checkingPort, setCheckingPort] = useState(false)
	const [testOpen, setTestOpen] = useState(false)
	const [testConfig, setTestConfig] = useState('')
	const [portChecks, setPortChecks] = useState<Record<string, { status: 'checking' | 'ok' | 'fail'; message?: string; port?: number }>>({})
	const portCheckTimers = useRef<Record<string, number>>({})
	const [structured, setStructured] = useState<StructuredConfig>({
		entry_node_id: '', entry_port: '', protocol: 'both', target_type: 'custom',
		target_node_id: '', target_host: '', target_port: '', relays: [],
		strategy: 'priority', active_relay_node_id: '', hops: []
	})

	const linuxFilter = (node: NodeDetail) => (node.os || '').toLowerCase().includes('linux')
	const selectedNodeIds = useMemo(() => {
		const ids = new Set<string>()
		if (structured.entry_node_id) ids.add(structured.entry_node_id)
		if (structured.target_type === 'node' && structured.target_node_id) ids.add(structured.target_node_id)
		structured.relays?.forEach(r => r.node_id && ids.add(r.node_id))
		structured.hops?.forEach(hop => {
			if (hop.type === 'direct' && hop.node_id) ids.add(hop.node_id)
			if (hop.type === 'relay_group') hop.relays?.forEach(r => r.node_id && ids.add(r.node_id))
		})
		return Array.from(ids)
	}, [structured])

	const excludeFor = (current: string[] = []) => {
		const currentSet = new Set(current.filter(Boolean))
		return selectedNodeIds.filter(id => !currentSet.has(id))
	}

	useEffect(() => {
		setForm(initial)
		setPortChecks({})
		try {
			const parsed = JSON.parse(initial.config_json || '{}')
			const cfg: StructuredConfig = {
				entry_node_id: parsed.entry_node_id || '',
				entry_port: parsed.entry_port || '',
				entry_current_port: parsed.entry_current_port || 0,
				protocol: parsed.protocol || 'both',
				target_type: parsed.target_type || 'custom',
				target_node_id: parsed.target_node_id || '',
				target_host: parsed.target_host || '',
				target_port: parsed.target_port?.toString?.() || '',
				relays: (parsed.relays || []).map((r: any, idx: number) => ({
					node_id: r.node_id || '', port: r.port || '',
					sort_order: r.sort_order ?? idx + 1, current_port: r.current_port || 0
				})),
				strategy: parsed.strategy || 'priority',
				active_relay_node_id: parsed.active_relay_node_id || '',
				hops: (parsed.hops || []).map((h: any, idx: number) =>
					h.type === 'relay_group'
						? { id: `hop-${idx}`, type: 'relay_group' as const,
							relays: (h.relays || []).map((r: any, ridx: number) => ({
								node_id: r.node_id || '', port: r.port || '',
								sort_order: r.sort_order ?? ridx + 1, current_port: r.current_port || 0
							})),
							strategy: h.strategy || 'priority', active_relay_node_id: h.active_relay_node_id || '' }
						: { id: `hop-${idx}`, type: 'direct' as const, node_id: h.node_id || '',
							port: h.port || '', current_port: h.current_port || 0, sort_order: h.sort_order || idx + 1 }
				)
			}
			setStructured(cfg)
			setMode('structured')
		} catch {
			setMode('raw')
		}
	}, [initial])

	useEffect(() => {
		setStructured(prev => ({
			...prev,
			relays: form.type === 'relay_group' ? prev.relays : [],
			hops: form.type === 'chain' ? prev.hops : [],
			strategy: form.type === 'relay_group' ? prev.strategy : prev.strategy || 'priority',
			active_relay_node_id: form.type === 'relay_group' ? prev.active_relay_node_id : ''
		}))
	}, [form.type])

	const nodeMap = useMemo(() => {
		const map: Record<string, string> = {}
		nodeDetail.forEach(n => (map[n.uuid] = n.name || n.uuid))
		return map
	}, [nodeDetail])

	const buildConfigPayload = () => {
		return {
			entry_node_id: structured.entry_node_id, entry_port: structured.entry_port,
			entry_current_port: structured.entry_current_port || 0,
			entry_realm_config: '', protocol: structured.protocol,
			target_type: structured.target_type,
			target_node_id: structured.target_type === 'node' ? structured.target_node_id : null,
			target_host: structured.target_type === 'custom' ? structured.target_host : null,
			target_port: Number(structured.target_port) || 0,
			relays: structured.relays.map((r, idx) => ({
				node_id: r.node_id, port: r.port, current_port: r.current_port || 0,
				realm_config: '', sort_order: r.sort_order || idx + 1
			})),
			strategy: structured.strategy, active_relay_node_id: structured.active_relay_node_id || '',
			hops: structured.hops.map((h, idx) =>
				h.type === 'relay_group'
					? { type: 'relay_group', relays: h.relays.map((r, ridx) => ({
							node_id: r.node_id, port: r.port, current_port: r.current_port || 0,
							realm_config: '', sort_order: r.sort_order || ridx + 1
						})), strategy: h.strategy || 'priority', active_relay_node_id: h.active_relay_node_id || '', sort_order: idx + 1 }
					: { type: 'direct', node_id: h.node_id, port: h.port, current_port: h.current_port || 0,
						realm_config: '', sort_order: h.sort_order || idx + 1 }
			),
			type: form.type
		}
	}

	const handleSubmit = async () => {
		setSaving(true)
		try {
			if (mode === 'structured') {
				if (!validateStructured(form.type, structured, t)) return
				const cfg = buildConfigPayload()
				await onSubmit({ ...form, config_json: JSON.stringify(cfg, null, 2) })
			} else {
				await onSubmit(form)
			}
		} finally { setSaving(false) }
	}

	const openTestConnectivity = () => {
		const config = mode === 'structured' ? JSON.stringify(buildConfigPayload()) : form.config_json
		if (!config) {
			toast.error(t('forward.config', { defaultValue: '配置' }) + ' ' + t('common.required', { defaultValue: '必填' }))
			return
		}
		setTestConfig(config)
		setTestOpen(true)
	}

	const formDisabled = false

	const updateHop = (id: string, updater: (hop: HopForm) => HopForm) => {
		setStructured(prev => ({ ...prev, hops: prev.hops.map(h => h.id === id ? updater(h) : h) }))
	}

	const checkPortStatus = async (nodeId: string, portSpec: string) => {
		const res = await fetch('/api/v1/forwards/check-port', {
			method: 'POST', headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ rule_id: initial.id, node_id: nodeId, port_spec: portSpec })
		})
		if (!res.ok) throw new Error(`HTTP ${res.status}`)
		return (await res.json()).data || null
	}

	const checkPort = async (nodeId: string, portSpec: string, onOk: (val: number) => void) => {
		if (!nodeId || !portSpec) {
			toast.error(t('forward.portCheckNeedNode', { defaultValue: '请先选择节点并填写端口' }))
			return
		}
		if (checkingPort) return
		setCheckingPort(true)
		try {
			const result = await checkPortStatus(nodeId, portSpec)
			if (result?.success && result.available_port) {
				onOk(result.available_port)
				toast.success(t('forward.portCheckSuccess', { defaultValue: '端口可用：{{port}}', port: result.available_port }))
			} else toast.error(result?.message || t('forward.portCheckFailed', { defaultValue: '端口不可用' }))
		} catch (e: any) { toast.error(e?.message || 'Check failed') }
		finally { setCheckingPort(false) }
	}

	const schedulePortCheck = (key: string, nodeId: string, portSpec: string) => {
		if (!nodeId || !portSpec) { setPortChecks(prev => { const n = { ...prev }; delete n[key]; return n }); return }
		if (portCheckTimers.current[key]) clearTimeout(portCheckTimers.current[key])
		portCheckTimers.current[key] = window.setTimeout(async () => {
			setPortChecks(prev => ({ ...prev, [key]: { status: 'checking' } }))
			try {
				const result = await checkPortStatus(nodeId, portSpec)
				setPortChecks(prev => result?.success && result.available_port
					? { ...prev, [key]: { status: 'ok', port: result.available_port, message: result.message } }
					: { ...prev, [key]: { status: 'fail', message: result?.message || t('forward.portCheckFailed') } })
			} catch (e: any) { setPortChecks(prev => ({ ...prev, [key]: { status: 'fail', message: e?.message || t('forward.portCheckFailed') } })) }
		}, 600)
	}

	useEffect(() => () => Object.values(portCheckTimers.current).forEach(t => clearTimeout(t)), [])

	const renderPortStatus = (key: string) => {
		const s = portChecks[key]
		if (!s) return null
		if (s.status === 'checking') return <span className="text-xs text-gray-9 animate-pulse">{t('forward.checkingPort', { defaultValue: '检查中…' })}</span>
		if (s.status === 'ok') return <span className="text-xs text-green-10">{t('forward.portOk', { defaultValue: '可用' })}</span>
		return <span className="text-xs text-red-10">{s.message || t('forward.portCheckFailed', { defaultValue: '端口不可用' })}</span>
	}

	const typeOptions = [
		{ value: 'direct', label: t('forward.typeDirect'), icon: ArrowRight, color: 'blue', description: '入口 -> 目标' },
		{ value: 'relay_group', label: t('forward.typeRelayGroup'), icon: Waypoints, color: 'teal', description: '入口 -> [中继组] -> 目标' },
		{ value: 'chain', label: t('forward.typeChain'), icon: Link2, color: 'orange', description: '入口 -> [跳点1] -> [跳点2] -> ...' }
	]

	return (
		<>
			<Drawer open={open} onOpenChange={o => !o && onClose()} direction={isMobile ? 'bottom' : 'right'}>
				{/* 调整桌面端侧滑宽度为 ~800，并保留最大宽度保护；移动端保持原有高度策略 */}
				<DrawerContent className={isMobile ? 'max-h-[95vh]' : 'w-[840px] max-w-[95vw]'}>
					{/* Header */}
					<DrawerHeader className="px-6 py-4 border-b">
						<Flex justify="between" align="center">
							<Flex align="center" gap="3">
								<div className="w-9 h-9 rounded-lg bg-accent-9 flex items-center justify-center shadow-sm">
									<Network size={18} className="text-white" />
								</div>
								<div>
									<DrawerTitle className="text-lg font-semibold">{form.id ? t('forward.edit') : t('forward.create')}</DrawerTitle>
										<Text size="2" color="gray">{form.id ? `ID: ${form.id}` : t('forward.createDesc', { defaultValue: '创建新的转发规则' })}</Text>
									</div>
								</Flex>
								<Flex align="center" gap="3">
									<Flex align="center" gap="2" className="px-2 py-1 rounded-md bg-gray-2 border">
										<Switch id="enabled-switch" size="1" checked={form.is_enabled} onCheckedChange={c => setForm({ ...form, is_enabled: Boolean(c) })} disabled={formDisabled} />
										<label htmlFor="enabled-switch">
										<Text size="2" color={form.is_enabled ? 'green' : 'gray'}>{form.is_enabled ? t('forward.enabled') : t('forward.disabled', { defaultValue: '禁用' })}</Text>
									</label>
								</Flex>
							</Flex>
						</Flex>
					</DrawerHeader>

						{/* Content */}
						<div className="flex-1 overflow-y-auto p-6 bg-transparent">
							<div className="route-surface space-y-3">

								{/* 基本信息：改为与路由一致的卡片风格 */}
								<div className="route-card">
									<div className="route-card-header">
										<div>
											<div className="route-card-title">{t('forward.basicInfo', { defaultValue: '基本信息' })}</div>
											<div className="route-card-subtitle">{t('forward.basicInfoSub', { defaultValue: '配置名称、分组、标签与备注。' })}</div>
										</div>
									</div>
									<div className="route-card-body">
										<div className="grid grid-cols-12 gap-3">
											<div className="col-span-12 md:col-span-6">
												<FieldGroup label={t('forward.name')} required>
													<TextField.Root
														size="2"
														value={form.name}
														onChange={e => setForm({ ...form, name: e.target.value })}
														placeholder={t('forward.namePlaceholder', { defaultValue: '例如: 游戏加速-美西' })}
														disabled={formDisabled}
													/>
												</FieldGroup>
											</div>
											<div className="col-span-12 md:col-span-6">
												<FieldGroup label={t('forward.group')}>
													<TextField.Root
														size="2"
														value={form.group_name}
														onChange={e => setForm({ ...form, group_name: e.target.value })}
														placeholder={t('forward.groupPlaceholder', { defaultValue: '例如: 游戏加速' })}
														disabled={formDisabled}
													/>
												</FieldGroup>
											</div>
											<div className="col-span-12 md:col-span-6">
												<FieldGroup label={t('forward.tags')} hint={t('forward.tagsHint', { defaultValue: '逗号分隔' })}>
													<TextField.Root size="2" value={form.tags} onChange={e => setForm({ ...form, tags: e.target.value })} placeholder="tcp, game" disabled={formDisabled} />
												</FieldGroup>
											</div>
											<div className="col-span-12 md:col-span-6">
												<FieldGroup label={t('forward.notes')}>
													<TextField.Root
														size="2"
														value={form.notes}
														onChange={e => setForm({ ...form, notes: e.target.value })}
														placeholder={t('forward.notesPlaceholder', { defaultValue: '备注...' })}
														disabled={formDisabled}
													/>
												</FieldGroup>
											</div>
										</div>
									</div>
								</div>

								{/* 规则类型：使用同样的 route-card 风格 */}
								{mode === 'structured' && (
									<div className="route-card">
										<div className="route-card-header">
											<div>
												<div className="route-card-title">{t('forward.ruleType', { defaultValue: '规则类型' })}</div>
												<div className="route-card-subtitle">{t('forward.ruleTypeSub', { defaultValue: '类型决定后续表单结构与路由链路。' })}</div>
											</div>
										</div>
										<div className="route-card-body space-y-2">
											<RadioGroup.Root
												value={form.type}
												onValueChange={v => setForm({ ...form, type: v })}
												orientation="vertical"
												className="flex flex-wrap flex-row! gap-5!">
												{typeOptions.map(opt => {
													const Icon = opt.icon
													return (
														<RadioGroup.Item key={opt.value} value={opt.value}>
															<Flex align="center" gap="2">
																<Icon size={16} />
																<Text size="2">{opt.label}</Text>
															</Flex>
														</RadioGroup.Item>
													)
												})}
											</RadioGroup.Root>
											<Text size="1" color="gray" className="route-help">
												{form.type === 'direct' && t('forward.descDirect', { defaultValue: '入口 -> 目标' })}
												{form.type === 'relay_group' && t('forward.descRelayGroup', { defaultValue: '入口 -> 中继组 -> 目标' })}
												{form.type === 'chain' && t('forward.descChain', { defaultValue: '入口 -> 跳点(可叠加) -> 目标' })}
											</Text>
										</div>
									</div>
								)}

								{/* 路由与目标配置：用「链路流向」呈现（入口 ↓ 中继/跳点 ↓ 目标） */}
								<div className="route-card">
										<div className="route-card-header">
											<div>
												<div className="route-card-title">{t('forward.routeConfig', { defaultValue: '路由与目标配置' })}</div>
												<div className="route-card-subtitle">{t('forward.routeConfigSub', { defaultValue: '按链路顺序配置入口、（可选）中继/跳点，以及最终目标。' })}</div>
											</div>
										</div>

									<div className="route-card-body">
										{/* 入口 */}
										<div className="flow-node">
											<div className="flow-node-header">
												<div className="w-full text-center">
													<div className="flow-node-title">{t('forward.entry', { defaultValue: '入口' })}</div>
													<div className="flow-node-subtitle">{t('forward.entryConfigSub', { defaultValue: '选择入口节点与端口，并设置协议' })}</div>
												</div>
											</div>
											<div className="flow-node-body">
												<div className="grid grid-cols-12 gap-3">
													<div className="col-span-12 md:col-span-6">
														<FieldGroup label={t('forward.entry')} required>
															<NodeSelectorDialog
																value={structured.entry_node_id ? [structured.entry_node_id] : []}
																onChange={ids => {
																	setStructured(p => ({ ...p, entry_node_id: ids[0] || '' }))
																	schedulePortCheck('entry', ids[0] || '', structured.entry_port)
																}}
																title={t('forward.entry')}
																hiddenDescription
																showViewModeToggle
																disabled={formDisabled}
																filterNode={linuxFilter}
																excludeIds={excludeFor([structured.entry_node_id])}
																block>
																<button
																	type="button"
																	disabled={formDisabled}
																	className={[
																		'w-full inline-flex items-center justify-between rounded-md px-0 py-2 text-sm',
																		'text-accent-11 hover:underline underline-offset-2',
																		formDisabled ? 'opacity-60 cursor-not-allowed no-underline' : ''
																	].join(' ')}>
																	<span className={structured.entry_node_id ? 'text-(--gray-12)' : 'text-accent-11'}>
																		{structured.entry_node_id
																			? (nodeMap[structured.entry_node_id] || structured.entry_node_id)
																			: t('forward.selectEntry', { defaultValue: '选择入口...' })}
																	</span>
																	<span className="text-gray-10">
																		{structured.entry_node_id ? t('common.change', { defaultValue: '更换' }) : ''}
																	</span>
																</button>
															</NodeSelectorDialog>
														</FieldGroup>
													</div>
													<div className="col-span-12 md:col-span-4">
														<FieldGroup label={t('forward.entryPort')} required>
															<Flex gap="2" align="center">
																<div className="flex-1 relative">
																	<TextField.Root
																		size="2"
																		value={structured.entry_port}
																		onChange={e => {
																			setStructured(p => ({ ...p, entry_port: e.target.value }))
																			schedulePortCheck('entry', structured.entry_node_id, e.target.value)
																		}}
																		placeholder="8881"
																		disabled={formDisabled}
																	/>
																	<div className="absolute right-2 top-1/2 -translate-y-1/2">{renderPortStatus('entry')}</div>
																</div>
																<Button
																	size="1"
																	variant="soft"
																	onClick={() =>
																		checkPort(structured.entry_node_id, structured.entry_port, val =>
																			setStructured(p => ({ ...p, entry_current_port: val }))
																		)
																	}
																	disabled={formDisabled || checkingPort}>
																	{t('forward.checkPortNow', { defaultValue: '检查' })}
																</Button>
															</Flex>
															<div className="route-help mt-1">{t('forward.portSpecHint', { defaultValue: '支持：8881 / 10000-20000 / 8881,8882,8883' })}</div>
														</FieldGroup>
													</div>
													<div className="col-span-12 md:col-span-2">
														<FieldGroup label={t('forward.protocol')}>
															<Select.Root size="2" value={structured.protocol} onValueChange={v => setStructured(p => ({ ...p, protocol: v as any }))} disabled={formDisabled}>
																<Select.Trigger className="w-full" />
																<Select.Content position="popper">
																	<Select.Item value="tcp">TCP</Select.Item>
																	<Select.Item value="udp">UDP</Select.Item>
																	<Select.Item value="both">TCP/UDP</Select.Item>
																</Select.Content>
															</Select.Root>
														</FieldGroup>
													</div>
												</div>
											</div>
										</div>

										<div className="flow-arrow">
											<ArrowDown size={18} />
										</div>

										{/* 中继模式 */}
										{form.type === 'relay_group' && (
											<>
													<div className="flow-node">
														<div className="flow-node-header">
															<div className="w-full text-center">
																<div className="flow-node-title">{t('forward.relayConfig', { defaultValue: '中继节点' })}</div>
																<div className="flow-node-subtitle">{t('forward.relayConfigSub', { defaultValue: '批量选择中继节点，并为每个节点设置端口与权重/优先级' })}</div>
															</div>
														</div>
													<div className="flow-node-body space-y-3">
															<RelayEditor
																relays={structured.relays}
																strategy={structured.strategy}
																onChange={r => setStructured(p => ({ ...p, relays: r }))}
																disabled={formDisabled}
																filterNode={linuxFilter}
																excludeFor={excludeFor}
																schedulePortCheck={schedulePortCheck}
																renderPortStatus={renderPortStatus}
																checkPort={checkPort}
															/>
														<FieldGroup label={t('forward.strategy', { defaultValue: '策略' })}>
															<RadioGroup.Root
																value={structured.strategy}
																onValueChange={v => setStructured(p => ({ ...p, strategy: v }))}
																orientation="vertical"
																className="flex flex-wrap flex-row! gap-5!"
																disabled={formDisabled}>
																<RadioGroup.Item value="priority">{t('forward.strategyPriority', { defaultValue: '优先级' })}</RadioGroup.Item>
																<RadioGroup.Item value="roundrobin">{t('forward.strategyRoundRobin', { defaultValue: '轮询' })}</RadioGroup.Item>
																<RadioGroup.Item value="random">{t('forward.strategyRandom', { defaultValue: '随机' })}</RadioGroup.Item>
																<RadioGroup.Item value="iphash">{t('forward.strategyIPHash', { defaultValue: 'IP Hash' })}</RadioGroup.Item>
															</RadioGroup.Root>
														</FieldGroup>
													</div>
												</div>
												<div className="flow-arrow">
													<ArrowDown size={18} />
												</div>
											</>
										)}

										{/* 链式模式：跳点按顺序展示（入口 ↓ hop1 ↓ hop2 ↓ 目标） */}
										{form.type === 'chain' && (
											<>
													{structured.hops.length === 0 ? (
														<div className="flow-node">
															<div className="flow-node-header">
																<div className="w-full text-center">
																	<div className="flow-node-title">{t('forward.chainConfig', { defaultValue: '链路跳点' })}</div>
																	<div className="flow-node-subtitle">{t('forward.noHops', { defaultValue: '暂无跳点，请从右上角添加直连或中继组。' })}</div>
																</div>
															</div>
														<div className="flow-node-body">
															<div className="route-help">{t('forward.chainConfigSub', { defaultValue: '跳点会按顺序串联，流量依次经过每个跳点。' })}</div>
														</div>
													</div>
												) : (
													<div className="space-y-0">
														{structured.hops.map((hop, idx) => (
															<div key={hop.id}>
																<HopCard
																		hop={hop}
																		index={idx}
																		nodeMap={nodeMap}
																		onUpdate={updater => updateHop(hop.id, updater)}
																		onRemove={() => setStructured(p => ({ ...p, hops: p.hops.filter(h => h.id !== hop.id) }))}
																		disabled={formDisabled}
																		filterNode={linuxFilter}
																		excludeFor={excludeFor}
																		schedulePortCheck={schedulePortCheck}
																		renderPortStatus={renderPortStatus}
																		checkPort={checkPort}
																	/>
																{idx < structured.hops.length - 1 && (
																	<div className="flow-arrow">
																		<ArrowDown size={18} />
																	</div>
																)}
															</div>
														))}
													</div>
												)}

												<Flex justify="end" gap="2" className="pt-3">
													<Button
														size="1"
														variant="soft"
														disabled={formDisabled}
														onClick={() => setStructured(p => ({ ...p, hops: [...p.hops, { id: uid(), type: 'direct', node_id: '', port: '', current_port: 0 }] }))}>
														<Plus size={14} /> {t('forward.addDirectHop', { defaultValue: '新增直连' })}
													</Button>
													<Button
														size="1"
														variant="soft"
														disabled={formDisabled}
														onClick={() => setStructured(p => ({ ...p, hops: [...p.hops, { id: uid(), type: 'relay_group', relays: [], strategy: 'priority', active_relay_node_id: '' }] }))}>
														<Plus size={14} /> {t('forward.addRelayHop', { defaultValue: '新增中继组' })}
													</Button>
												</Flex>

												<div className="flow-arrow">
													<ArrowDown size={18} />
												</div>
											</>
										)}

										{/* 目标 */}
										<div className="flow-node">
											<div className="flow-node-header">
												<div className="w-full text-center">
													<div className="flow-node-title">{t('forward.targetConfig', { defaultValue: '目标' })}</div>
													<div className="flow-node-subtitle">{t('forward.targetConfigSub', { defaultValue: '选择目标节点或填写自定义目标地址与端口' })}</div>
												</div>
											</div>
											<div className="flow-node-body">
												<TargetSelector
													structured={structured}
													setStructured={setStructured}
													disabled={formDisabled}
													filterNode={linuxFilter}
													excludeIds={excludeFor([structured.target_node_id])}
													nodeMap={nodeMap}
												/>
											</div>
										</div>
									</div>
								</div>

							{/* Raw Mode */}
							{mode === 'raw' && (
								<div className="route-card">
								<div className="route-card-header">
									<div>
										<div className="route-card-title">{t('forward.rawConfig', { defaultValue: '原始 JSON 配置' })}</div>
										<div className="route-card-subtitle">{t('forward.rawConfigSub', { defaultValue: '直接编辑 JSON 配置（高级用户）。' })}</div>
									</div>
								</div>
								<div className="route-card-body">
									<FieldGroup label={t('forward.config', { defaultValue: '配置' })}>
										<TextArea
											rows={22}
											value={form.config_json}
											onChange={e => setForm({ ...form, config_json: e.target.value })}
											placeholder={t('forward.configPlaceholder', { defaultValue: '{\\n  ...\\n}' })}
											disabled={formDisabled}
											className="font-mono text-sm bg-[var(--gray-1)]"
										/>
									</FieldGroup>
								</div>
							</div>
						)}


									{/* 已按需求移除：高级配置 / Realm 模板 / 告警与配置预览 */}

								</div>
							</div>

							{/* Footer */}
							<DrawerFooter className="px-6 py-3 border-t">
							<Flex justify="between" align="center">
								<Flex gap="3">
								<Button size="2" variant="ghost" onClick={openTestConnectivity} disabled={saving}>
									<TestTube size={16} /> {t('forward.testConnectivity')}
								</Button>
								<Flex gap="1" className="p-0.5 bg-gray-2 border rounded-md items-center">
									<button
										type="button"
										onClick={() => !formDisabled && setMode('structured')}
										className={`px-2 py-1 text-sm rounded-md transition-all ${mode === 'structured' ? 'bg-white shadow-sm' : 'text-(--gray-11) hover:text-(--gray-12)'}`}
									>{t('forward.modeStructured')}</button>
									<button
										type="button"
										onClick={() => !formDisabled && setMode('raw')}
										className={`px-2 py-1 text-sm rounded-md transition-all ${mode === 'raw' ? 'bg-white shadow-sm' : 'text-(--gray-11) hover:text-(--gray-12)'}`}
									>{t('forward.modeRaw')}</button>
								</Flex>
							</Flex>
							<Flex gap="3">
								<DrawerClose asChild>
									<Button size="2" variant="soft" color="gray"><X size={16} /> {t('forward.cancel')}</Button>
								</DrawerClose>
								<Button size="2" onClick={handleSubmit} disabled={saving}>
									<Save size={16} /> {saving ? t('common.saving', { defaultValue: '保存中...' }) : t('forward.submit')}
								</Button>
							</Flex>
						</Flex>
					</DrawerFooter>
				</DrawerContent>
			</Drawer>
			<TestConnectivityDialog open={testOpen} configJson={testConfig} onClose={() => setTestOpen(false)} />
		</>
	)
}

// Sub-components
const FieldGroup = ({ label, required, hint, children }: { label?: string; required?: boolean; hint?: string; children: ReactNode }) => (
	<div className="space-y-1.5">
		{label && (
			<Flex align="center" gap="1.5">
				<Text size="2" weight="medium" as="label" className="text-(--gray-11)">{label}</Text>
				{required && <span className="text-red-9 text-sm">*</span>}
			</Flex>
		)}
		{children}
		{hint && <Text size="1" color="gray">{hint}</Text>}
	</div>
)

const TargetSelector = ({ structured, setStructured, disabled, filterNode, excludeIds, nodeMap }: {
	structured: StructuredConfig; setStructured: React.Dispatch<React.SetStateAction<StructuredConfig>>
	disabled?: boolean; filterNode?: (node: NodeDetail) => boolean; excludeIds?: string[]
	nodeMap: Record<string, string>
}) => {
	const { t } = useTranslation()
	return (
		<div className="flex flex-wrap items-end gap-3">
			<div className="min-w-[220px]">
				<FieldGroup label={t('forward.targetType', { defaultValue: '类型' })}>
					<RadioGroup.Root
						value={structured.target_type}
						onValueChange={v => setStructured(p => ({ ...p, target_type: v as 'node' | 'custom' }))}
						orientation="vertical"
						className="flex flex-wrap flex-row! gap-5!"
						disabled={disabled}>
						<RadioGroup.Item value="custom">{t('forward.customTarget', { defaultValue: '自定义' })}</RadioGroup.Item>
						<RadioGroup.Item value="node">{t('forward.nodeTarget', { defaultValue: '节点' })}</RadioGroup.Item>
					</RadioGroup.Root>
				</FieldGroup>
			</div>
			{structured.target_type === 'node' ? (
				<>
					<div className="flex-1 min-w-[260px]">
						<FieldGroup label={t('forward.targetNode')} required>
							<NodeSelectorDialog
								value={structured.target_node_id ? [structured.target_node_id] : []}
								onChange={ids => setStructured(p => ({ ...p, target_node_id: ids[0] || '' }))}
								title={t('forward.targetNode')}
								hiddenDescription
								showViewModeToggle
								disabled={disabled}
								filterNode={filterNode}
								excludeIds={excludeIds}
								block>
								<button
									type="button"
									disabled={disabled}
									className={[
										'w-full inline-flex items-center justify-between rounded-md px-0 py-2 text-sm',
										'text-accent-11 hover:underline underline-offset-2',
										disabled ? 'opacity-60 cursor-not-allowed no-underline' : ''
									].join(' ')}>
									<span className={structured.target_node_id ? 'text-(--gray-12)' : 'text-accent-11'}>
										{structured.target_node_id
											? (nodeMap[structured.target_node_id] || structured.target_node_id)
											: t('forward.selectTarget', { defaultValue: '选择目标...' })}
									</span>
									<span className="text-gray-10">
										{structured.target_node_id ? t('common.change', { defaultValue: '更换' }) : ''}
									</span>
								</button>
							</NodeSelectorDialog>
						</FieldGroup>
					</div>
					<div className="w-[160px] min-w-[140px]">
						<FieldGroup label={t('forward.targetPort')} required>
							<TextField.Root
								size="2"
								value={structured.target_port}
								onChange={e => setStructured(p => ({ ...p, target_port: e.target.value }))}
								placeholder="4188"
								disabled={disabled}
							/>
						</FieldGroup>
					</div>
				</>
			) : (
				<>
					<div className="flex-1 min-w-[260px]">
						<FieldGroup label={t('forward.targetHost')} required>
							<TextField.Root size="2" value={structured.target_host} onChange={e => setStructured(p => ({ ...p, target_host: e.target.value }))} placeholder="1.1.1.1" disabled={disabled} />
						</FieldGroup>
					</div>
					<div className="w-[160px] min-w-[140px]">
						<FieldGroup label={t('forward.targetPort')} required>
							<TextField.Root size="2" value={structured.target_port} onChange={e => setStructured(p => ({ ...p, target_port: e.target.value }))} placeholder="53" disabled={disabled} />
						</FieldGroup>
					</div>
				</>
			)}
		</div>
	)
}

	const RelayEditor = ({ relays, strategy, onChange, disabled, filterNode, excludeFor, schedulePortCheck, renderPortStatus, checkPort }: {
		relays: RelayForm[]; strategy?: string; onChange: (r: RelayForm[]) => void
		disabled?: boolean; filterNode?: (node: NodeDetail) => boolean; excludeFor?: (current: string[]) => string[]
		schedulePortCheck?: (key: string, nodeId: string, portSpec: string) => void
		renderPortStatus?: (key: string) => ReactNode
		checkPort?: (nodeId: string, portSpec: string, onOk: (val: number) => void) => void
	}) => {
	const { t } = useTranslation()
	const addRelays = (ids: string[]) => {
		if (!ids?.length) return
		const existing = new Set(relays.map(r => r.node_id))
		const filtered = ids.filter(id => !existing.has(id))
		if (!filtered.length) return
		onChange([...relays, ...filtered.map((id, idx) => ({ node_id: id, port: '', sort_order: relays.length + idx + 1 }))])
	}

	const priorityMode = strategy === 'priority'

	return (
		<div className="space-y-3">
			<Flex justify="end" align="center">
				<NodeSelectorDialog value={[]} onChange={addRelays} title={t('forward.addRelay')} hiddenDescription showViewModeToggle disabled={disabled} filterNode={filterNode} excludeIds={excludeFor?.([]) || []}>
					<Button size="1" variant="soft" disabled={disabled}><Plus size={14} /> {t('forward.addRelay', { defaultValue: '添加中继' })}</Button>
				</NodeSelectorDialog>
			</Flex>
			{relays.length === 0 ? (
				<div className="py-6 text-center rounded-lg bg-slate-50 ring-1 ring-black/5">
					<Server size={22} className="mx-auto mb-2 text-slate-400" />
					<Text size="2" color="gray">{t('forward.noRelay')}</Text>
				</div>
			) : (
				<div className="space-y-2">
					{relays.map((r, idx) => (
						<Flex key={`${r.node_id}-${idx}`} gap="3" align="center" className="px-3 py-2 rounded-lg bg-slate-50 ring-1 ring-black/5">
							<Text size="2" color="gray" className="w-5 font-mono">{idx + 1}.</Text>
							<div className="flex-1">
								<NodeSelectorDialog value={r.node_id ? [r.node_id] : []} onChange={ids => { onChange(relays.map((x, i) => i === idx ? { ...x, node_id: ids[0] || '' } : x)); schedulePortCheck?.(`relay-${idx}`, ids[0] || '', r.port) }}
									title={t('forward.targetNode')} hiddenDescription showViewModeToggle disabled={disabled} filterNode={filterNode} excludeIds={excludeFor?.([r.node_id]) || []} block triggerSize="1" />
							</div>
                            <div className="w-52 relative">
                                <TextField.Root size="1" value={r.port} onChange={e => { onChange(relays.map((x, i) => i === idx ? { ...x, port: e.target.value } : x)); schedulePortCheck?.(`relay-${idx}`, r.node_id, e.target.value) }} placeholder="10000-20000" disabled={disabled} />
                                <div className="absolute right-1.5 top-1/2 -translate-y-1/2">{renderPortStatus?.(`relay-${idx}`)}</div>
                            </div>
                            <Flex align="center" gap="2" className="w-40">
                                <Text size="1" className="text-gray-10 whitespace-nowrap">{priorityMode ? t('forward.priority', { defaultValue: '优先级' }) : t('forward.weight', { defaultValue: '权重' })}</Text>
                                <TextField.Root size="1" type="number" min={1} value={r.sort_order} onChange={e => onChange(relays.map((x, i) => i === idx ? { ...x, sort_order: Number(e.target.value) || 1 } : x))} disabled={disabled} />
                            </Flex>
	                            <Button size="1" variant="soft" onClick={() => checkPort?.(r.node_id, r.port, () => {})} disabled={disabled || false}>{t('forward.checkPortNow', { defaultValue: '检查' })}</Button>
							<Button radius="full" size="1" variant="soft" color="red" onClick={() => onChange(relays.filter((_, i) => i !== idx))} disabled={disabled}><Trash2 size={14} /></Button>
						</Flex>
					))}
				</div>
			)}
		</div>
	)
}

	const HopCard = ({ hop, index, nodeMap, onUpdate, onRemove, disabled, filterNode, excludeFor, schedulePortCheck, renderPortStatus, checkPort }: {
		hop: HopForm; index: number; nodeMap: Record<string, string>
		onUpdate: (updater: (h: HopForm) => HopForm) => void; onRemove: () => void
		disabled?: boolean; filterNode?: (node: NodeDetail) => boolean; excludeFor?: (current: string[]) => string[]
		schedulePortCheck?: (key: string, nodeId: string, portSpec: string) => void
		renderPortStatus?: (key: string) => ReactNode
		checkPort?: (nodeId: string, portSpec: string, onOk: (val: number) => void) => void
	}) => {
		const { t } = useTranslation()
		const isDirect = hop.type === 'direct'
		return (
			<div className="flow-node">
				<div className="flow-node-header">
					<div>
						<div className="flow-node-title">
							{t('forward.hop', { defaultValue: '跳点' })} {index + 1} · {isDirect ? t('forward.directHop', { defaultValue: '直连' }) : t('forward.relayGroup', { defaultValue: '中继组' })}
						</div>
						<div className="flow-node-subtitle">
							{isDirect ? t('forward.hopDirectSub', { defaultValue: '节点 + 端口（可检查）' }) : t('forward.hopRelaySub', { defaultValue: '中继节点列表 + 策略（更易点击）' })}
						</div>
					</div>
					<Button size="1" variant="ghost" color="red" onClick={onRemove} disabled={disabled}>
						<Trash2 size={14} /> {t('common.remove', { defaultValue: '移除' })}
					</Button>
				</div>
				<div className="flow-node-body">
					{isDirect ? (
						<div className="flex flex-wrap items-end gap-3">
							<div className="flex-1 min-w-[260px]">
								<FieldGroup label={t('forward.node', { defaultValue: '节点' })} required>
									<NodeSelectorDialog
										value={hop.node_id ? [hop.node_id] : []}
										onChange={ids => {
											onUpdate(h => ({ ...h, node_id: ids[0] || '' } as HopForm))
											schedulePortCheck?.(`hop-${hop.id}`, ids[0] || '', hop.port)
										}}
										title={t('forward.targetNode')}
										hiddenDescription
										showViewModeToggle
										disabled={disabled}
										filterNode={filterNode}
										excludeIds={excludeFor?.([hop.node_id]) || []}
										block>
										<button
											type="button"
											disabled={disabled}
											className={[
												'w-full inline-flex items-center justify-between rounded-md px-0 py-2 text-sm',
												'text-accent-11 hover:underline underline-offset-2',
												disabled ? 'opacity-60 cursor-not-allowed no-underline' : ''
											].join(' ')}>
											<span className={hop.node_id ? 'text-(--gray-12)' : 'text-accent-11'}>
												{hop.node_id ? (nodeMap[hop.node_id] || hop.node_id) : t('forward.selectNode', { defaultValue: '选择节点...' })}
											</span>
											<span className="text-gray-10">
												{hop.node_id ? t('common.change', { defaultValue: '更换' }) : ''}
											</span>
										</button>
									</NodeSelectorDialog>
								</FieldGroup>
							</div>
							<div className="flex-1 min-w-[260px]">
								<FieldGroup label={t('forward.port', { defaultValue: '端口' })} required>
									<Flex gap="2" align="center">
										<div className="flex-1 relative">
											<TextField.Root
												size="2"
												value={hop.port}
												onChange={e => {
													onUpdate(h => ({ ...h, port: e.target.value } as HopForm))
													schedulePortCheck?.(`hop-${hop.id}`, hop.node_id, e.target.value)
												}}
												placeholder="10000-20000"
												disabled={disabled}
											/>
											<div className="absolute right-2 top-1/2 -translate-y-1/2">{renderPortStatus?.(`hop-${hop.id}`)}</div>
										</div>
										<Button size="1" variant="soft" onClick={() => checkPort?.(hop.node_id, hop.port, () => {})} disabled={disabled || false}>
											{t('forward.checkPortNow', { defaultValue: '检查' })}
										</Button>
									</Flex>
								</FieldGroup>
							</div>
						</div>
					) : (
						<div className="space-y-3">
							<RelayEditor
								relays={hop.relays}
								strategy={hop.strategy}
								onChange={r => onUpdate(h => ({ ...h, relays: r } as HopForm))}
								disabled={disabled}
								filterNode={filterNode}
								excludeFor={excludeFor}
								schedulePortCheck={(key, nodeId, portSpec) => schedulePortCheck?.(`hop-${hop.id}-${key}`, nodeId, portSpec)}
								renderPortStatus={key => renderPortStatus?.(`hop-${hop.id}-${key}`)}
								checkPort={checkPort}
							/>
							<FieldGroup label={t('forward.strategy', { defaultValue: '策略' })}>
								<RadioGroup.Root
									value={hop.strategy}
									onValueChange={v => onUpdate(h => ({ ...h, strategy: v } as HopForm))}
									orientation="vertical"
									className="flex flex-wrap flex-row! gap-5!"
									disabled={disabled}>
									<RadioGroup.Item value="priority">{t('forward.strategyPriority', { defaultValue: '优先级' })}</RadioGroup.Item>
									<RadioGroup.Item value="roundrobin">{t('forward.strategyRoundRobin', { defaultValue: '轮询' })}</RadioGroup.Item>
									<RadioGroup.Item value="random">{t('forward.strategyRandom', { defaultValue: '随机' })}</RadioGroup.Item>
									<RadioGroup.Item value="iphash">{t('forward.strategyIPHash', { defaultValue: 'IP Hash' })}</RadioGroup.Item>
								</RadioGroup.Root>
							</FieldGroup>
						</div>
					)}
				</div>
			</div>
		)
	}

const validateStructured = (type: string, cfg: StructuredConfig, t: any) => {
	const checkDuplicates = () => {
		const ids: string[] = []
		if (cfg.entry_node_id) ids.push(cfg.entry_node_id)
		if (cfg.target_type === 'node' && cfg.target_node_id) ids.push(cfg.target_node_id)
		cfg.relays?.forEach(r => r.node_id && ids.push(r.node_id))
		cfg.hops?.forEach(hop => {
			if (hop.type === 'direct' && hop.node_id) ids.push(hop.node_id)
			if (hop.type === 'relay_group') hop.relays?.forEach(r => r.node_id && ids.push(r.node_id))
		})
		const seen = new Set<string>()
		for (const id of ids) {
			if (seen.has(id)) { toast.error(t('forward.duplicateNode', { defaultValue: '节点不可重复使用' })); return false }
			seen.add(id)
		}
		return true
	}
	if (!cfg.entry_node_id) { toast.error(t('forward.entry') + ' ' + (t('common.required') || 'required')); return false }
	if (!cfg.entry_port) { toast.error(t('forward.entryPort') + ' ' + (t('common.required') || 'required')); return false }
	const checkTarget = () => {
		if (cfg.target_type === 'node') {
			if (!cfg.target_node_id) { toast.error(t('forward.targetNode') + ' ' + (t('common.required') || 'required')); return false }
		} else {
			if (!cfg.target_host || !cfg.target_port) { toast.error(t('forward.target') + ' ' + (t('common.required') || 'required')); return false }
		}
		return true
	}
	if (type === 'direct') return checkTarget() && checkDuplicates()
	if (type === 'relay_group') {
		if (!cfg.relays?.length) { toast.error(t('forward.relayNodes') + ' ' + (t('common.required') || 'required')); return false }
		for (const r of cfg.relays) if (!r.node_id || !r.port) { toast.error(t('forward.relayNodes') + ' ' + (t('common.required') || 'required')); return false }
		return checkTarget() && checkDuplicates()
	}
	if (type === 'chain') {
		if (!cfg.hops?.length) { toast.error(t('forward.addRelayHop')); return false }
		for (const hop of cfg.hops) {
			if (hop.type === 'direct') { if (!hop.node_id || !hop.port) { toast.error(t('forward.directHop') + ' ' + (t('common.required') || 'required')); return false } }
			else if (hop.type === 'relay_group') {
				if (!hop.relays?.length) { toast.error(t('forward.relayGroup') + ' ' + (t('common.required') || 'required')); return false }
				for (const r of hop.relays) if (!r.node_id || !r.port) { toast.error(t('forward.relayGroup') + ' ' + (t('common.required') || 'required')); return false }
			}
		}
		return checkTarget() && checkDuplicates()
	}
	return true
}

export default RuleFormDrawer
