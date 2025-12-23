import { Button, Flex, Select, Switch, Text, TextArea, TextField, RadioGroup } from '@radix-ui/themes'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Drawer, DrawerClose, DrawerContent, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import NodeSelectorDialog from '@/components/NodeSelectorDialog'
import AlertConfigCard, { defaultAlertConfig } from './AlertConfigCard'
import type { AlertConfig } from './AlertConfigCard'
import { Server, Waypoints, Link2, ArrowRight, Plus, Trash2, TestTube, Save, X, Network, LogIn, Target, Zap } from 'lucide-react'
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
	const [checkingPort, setCheckingPort] = useState(false)
	const [alertConfig, setAlertConfig] = useState<AlertConfig>(defaultAlertConfig)
	const [manualRealmEdit, setManualRealmEdit] = useState(false)
	const [realmNode, setRealmNode] = useState('')
	const [realmConfigs, setRealmConfigs] = useState<Record<string, string>>({})
	const [previewConfigs, setPreviewConfigs] = useState<Record<string, string>>({})
	const [previewLoading, setPreviewLoading] = useState(false)
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
			const manualMap: Record<string, string> = {}
			if (parsed.entry_node_id && parsed.entry_realm_config) manualMap[parsed.entry_node_id] = parsed.entry_realm_config
			parsed.relays?.forEach((r: any) => r?.node_id && r?.realm_config && (manualMap[r.node_id] = r.realm_config))
			parsed.hops?.forEach((hop: any) => {
				if (hop?.type === 'direct' && hop?.node_id && hop?.realm_config) manualMap[hop.node_id] = hop.realm_config
				if (hop?.type === 'relay_group') hop.relays?.forEach((r: any) => r?.node_id && r?.realm_config && (manualMap[r.node_id] = r.realm_config))
			})
			setRealmConfigs(manualMap)
			setManualRealmEdit(Object.values(manualMap).some(val => (val || '').trim().length > 0))
		} catch {
			setManualRealmEdit(false)
			setRealmConfigs({})
		}
	}, [initial])

	// 拉取告警配置（编辑时）
	useEffect(() => {
		const fetchAlert = async () => {
			if (!initial.id) { setAlertConfig(defaultAlertConfig); return }
			try {
				const res = await fetch(`/api/v1/forwards/${initial.id}/alert-config`)
				if (!res.ok) throw new Error(`HTTP ${res.status}`)
				const body = await res.json()
				setAlertConfig({
					enabled: body.data?.enabled ?? false,
					node_down_enabled: body.data?.node_down_enabled ?? true,
					link_degraded_enabled: body.data?.link_degraded_enabled ?? true,
					link_faulty_enabled: body.data?.link_faulty_enabled ?? true,
					high_latency_enabled: body.data?.high_latency_enabled ?? false,
					high_latency_threshold: body.data?.high_latency_threshold ?? 200,
					traffic_spike_enabled: body.data?.traffic_spike_enabled ?? false,
					traffic_spike_threshold: Number(body.data?.traffic_spike_threshold ?? 2)
				})
			} catch (e: any) {
				toast.error(e?.message || 'Load alert config failed')
				setAlertConfig(defaultAlertConfig)
			}
		}
		fetchAlert()
	}, [initial.id])

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

	const realmNodes = useMemo(() => {
		const items: { id: string; label: string }[] = []
		const seen = new Set<string>()
		const push = (id: string, prefix: string) => {
			if (!id || seen.has(id)) return
			seen.add(id)
			items.push({ id, label: `${prefix}: ${nodeMap[id] || id}` })
		}
		if (structured.entry_node_id) push(structured.entry_node_id, t('forward.entry'))
		structured.relays?.forEach(r => push(r.node_id, t('forward.relayNodes')))
		structured.hops?.forEach(hop => {
			if (hop.type === 'direct') push(hop.node_id, t('forward.directHop'))
			else if (hop.type === 'relay_group') hop.relays?.forEach(r => push(r.node_id, t('forward.relayGroup')))
		})
		return items
	}, [structured, nodeMap, t])

	useEffect(() => {
		if (!realmNodes.length) { setRealmNode(''); return }
		if (!realmNodes.some(n => n.id === realmNode)) setRealmNode(realmNodes[0].id)
	}, [realmNodes, realmNode])

	useEffect(() => {
		setRealmConfigs(prev => {
			if (!realmNodes.length) return prev
			const allow = new Set(realmNodes.map(n => n.id))
			return Object.fromEntries(Object.entries(prev).filter(([k]) => allow.has(k)))
		})
	}, [realmNodes])

	const buildConfigPayload = (includeManual: boolean) => {
		const realmFor = (nodeId: string) => (includeManual ? realmConfigs[nodeId] || '' : '')
		return {
			entry_node_id: structured.entry_node_id, entry_port: structured.entry_port,
			entry_current_port: structured.entry_current_port || 0,
			entry_realm_config: realmFor(structured.entry_node_id), protocol: structured.protocol,
			target_type: structured.target_type,
			target_node_id: structured.target_type === 'node' ? structured.target_node_id : null,
			target_host: structured.target_type === 'custom' ? structured.target_host : null,
			target_port: Number(structured.target_port) || 0,
			relays: structured.relays.map((r, idx) => ({
				node_id: r.node_id, port: r.port, current_port: r.current_port || 0,
				realm_config: realmFor(r.node_id), sort_order: r.sort_order || idx + 1
			})),
			strategy: structured.strategy, active_relay_node_id: structured.active_relay_node_id || '',
			hops: structured.hops.map((h, idx) =>
				h.type === 'relay_group'
					? { type: 'relay_group', relays: h.relays.map((r, ridx) => ({
							node_id: r.node_id, port: r.port, current_port: r.current_port || 0,
							realm_config: realmFor(r.node_id), sort_order: r.sort_order || ridx + 1
						})), strategy: h.strategy || 'priority', active_relay_node_id: h.active_relay_node_id || '', sort_order: idx + 1 }
					: { type: 'direct', node_id: h.node_id, port: h.port, current_port: h.current_port || 0,
						realm_config: realmFor(h.node_id), sort_order: h.sort_order || idx + 1 }
			),
			type: form.type
		}
	}

	const handleSubmit = async () => {
		setSaving(true)
		try {
			if (!validateStructured(form.type, structured, t)) return
			const cfg = buildConfigPayload(manualRealmEdit)
			await onSubmit({ ...form, config_json: JSON.stringify(cfg, null, 2) })
			if (form.id) await saveAlertConfig(form.id)
		} finally { setSaving(false) }
	}

	const openTestConnectivity = () => {
		const config = JSON.stringify(buildConfigPayload(manualRealmEdit))
		if (!config) {
			toast.error(t('forward.config', { defaultValue: '配置' }) + ' ' + t('common.required', { defaultValue: '必填' }))
			return
		}
		setTestConfig(config)
		setTestOpen(true)
	}

	const generatedPreview = useMemo(
		() => JSON.stringify(buildConfigPayload(manualRealmEdit), null, 2),
		[structured, manualRealmEdit, realmConfigs, form.type]
	)
	const previewConfigJSON = useMemo(() => JSON.stringify(buildConfigPayload(false), null, 2), [structured, form.type])

	useEffect(() => {
		if (manualRealmEdit) return
		if (!structured.entry_node_id || !structured.entry_port) return
		let cancelled = false
		const timer = setTimeout(async () => {
			setPreviewLoading(true)
			try {
				const res = await fetch('/api/v1/forwards/preview-config', {
					method: 'POST', headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ type: form.type, config_json: previewConfigJSON })
				})
				if (!res.ok) throw new Error(`HTTP ${res.status}`)
				const body = await res.json()
				if (!cancelled) setPreviewConfigs(body.data?.node_configs || {})
			} catch (e: any) {
				if (!cancelled) { setPreviewConfigs({}); toast.error(e?.message || 'Preview failed') }
			} finally { if (!cancelled) setPreviewLoading(false) }
		}, 300)
		return () => { cancelled = true; clearTimeout(timer) }
	}, [manualRealmEdit, form.type, previewConfigJSON])

	const formDisabled = manualRealmEdit
	const activeRealmConfig = manualRealmEdit ? realmConfigs[realmNode] || '' : previewConfigs[realmNode] || ''

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
		if (formDisabled || !nodeId || !portSpec) {
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

	const saveAlertConfig = async (id: number) => {
		try {
			const res = await fetch(`/api/v1/forwards/${id}/alert-config`, {
				method: 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(alertConfig)
			})
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
		} catch (e: any) { toast.error(e?.message || 'Save alert config failed') }
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
		{
			value: 'direct',
			label: t('forward.typeDirect', { defaultValue: '直连转发' }),
			icon: ArrowRight,
			color: 'blue',
			path: t('forward.directPath', { defaultValue: '入口 → 目标' }),
			description: t('forward.directDesc', { defaultValue: '最简单的转发模式，流量从入口节点直接转发到目标地址。适合入口节点网络质量良好、无需中转的场景。' }),
			features: [
				t('forward.directFeature1', { defaultValue: '延迟最低，无额外跳转' }),
				t('forward.directFeature2', { defaultValue: '配置简单，易于维护' })
			]
		},
		{
			value: 'relay_group',
			label: t('forward.typeRelayGroup', { defaultValue: '中继转发' }),
			icon: Waypoints,
			color: 'teal',
			path: t('forward.relayPath', { defaultValue: '入口 → 中继组 → 目标' }),
			description: t('forward.relayDesc', { defaultValue: '通过中继节点组转发流量，支持多种负载均衡策略。适合需要优化线路、提升稳定性或隐藏真实目标的场景。' }),
			features: [
				t('forward.relayFeature1', { defaultValue: '支持优先级、轮询、随机、IP Hash 策略' }),
				t('forward.relayFeature2', { defaultValue: '中继故障时自动切换备用节点' })
			]
		},
		{
			value: 'chain',
			label: t('forward.typeChain', { defaultValue: '链式转发' }),
			icon: Link2,
			color: 'orange',
			path: t('forward.chainPath', { defaultValue: '入口 → 跳点₁ → 跳点₂ → ... → 目标' }),
			description: t('forward.chainDesc', { defaultValue: '流量依次经过多个跳点节点，每个跳点可以是单节点或中继组。适合复杂网络环境、需要多层中转优化线路的场景。' }),
			features: [
				t('forward.chainFeature1', { defaultValue: '支持任意数量跳点串联' }),
				t('forward.chainFeature2', { defaultValue: '每个跳点可独立配置为直连或中继组' })
			]
		}
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

								{/* 规则类型 */}
								<div className="route-card">
									<div className="route-card-header">
										<div>
											<div className="route-card-title">{t('forward.ruleType', { defaultValue: '规则类型' })}</div>
											<div className="route-card-subtitle">{t('forward.ruleTypeSub', { defaultValue: '选择转发模式，不同类型决定流量的路由方式。' })}</div>
										</div>
									</div>
									<div className="route-card-body">
										<div className="grid grid-cols-1 md:grid-cols-3 gap-3">
											{typeOptions.map(opt => {
												const Icon = opt.icon
												const isSelected = form.type === opt.value
												const colorMap: Record<string, string> = {
													blue: 'var(--blue-9)',
													teal: 'var(--teal-9)',
													orange: 'var(--orange-9)'
												}
												const bgMap: Record<string, string> = {
													blue: 'var(--blue-3)',
													teal: 'var(--teal-3)',
													orange: 'var(--orange-3)'
												}
												return (
													<button
														key={opt.value}
														type="button"
														onClick={() => setForm({ ...form, type: opt.value })}
														disabled={formDisabled}
														className={[
															'relative text-left p-4 rounded-xl border-2 transition-all',
															isSelected
																? 'border-accent-8 bg-accent-2 shadow-sm'
																: 'border-transparent bg-slate-50 hover:bg-slate-100 hover:border-slate-200',
															formDisabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
														].join(' ')}>
														{/* 选中指示器 */}
														{isSelected && (
															<div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-accent-9 flex items-center justify-center">
																<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
																	<path d="M2.5 6L5 8.5L9.5 4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
																</svg>
															</div>
														)}
														{/* 图标 */}
														<div
															className="w-10 h-10 rounded-lg flex items-center justify-center mb-3"
															style={{ background: bgMap[opt.color], color: colorMap[opt.color] }}>
															<Icon size={20} />
														</div>
														{/* 标题和路径 */}
														<div className="font-semibold text-sm text-slate-900 mb-1">{opt.label}</div>
														<div className="text-xs text-slate-500 font-mono mb-2">{opt.path}</div>
														{/* 描述 */}
														<div className="text-xs text-slate-600 leading-relaxed mb-3">{opt.description}</div>
														{/* 特性列表 */}
														<div className="space-y-1">
															{opt.features.map((feature, idx) => (
																<div key={idx} className="flex items-start gap-1.5 text-xs text-slate-500">
																	<span className="mt-1 w-1 h-1 rounded-full bg-slate-400 shrink-0" />
																	<span>{feature}</span>
																</div>
															))}
														</div>
													</button>
												)
											})}
										</div>
									</div>
								</div>

								{/* 路由与目标配置：时间线布局 */}
								<div className="route-card">
									<div className="route-card-header">
										<div>
											<div className="route-card-title">{t('forward.routeConfig', { defaultValue: '路由与目标配置' })}</div>
											<div className="route-card-subtitle">{t('forward.routeConfigSub', { defaultValue: '按链路顺序配置入口、（可选）中继/跳点，以及最终目标。' })}</div>
										</div>
									</div>

									<div className="route-card-body">
										<div className="route-timeline">
											{/* 入口节点 */}
											<div className="timeline-step">
												<div className="timeline-dot entry">
													<LogIn size={12} />
												</div>
												<div className="timeline-content">
													<div className="timeline-header">
														<div className="timeline-header-left">
															<div className="timeline-icon entry">
																<LogIn size={16} />
															</div>
															<div>
																<div className="timeline-title">{t('forward.entry', { defaultValue: '入口' })}</div>
																<div className="timeline-subtitle">{t('forward.entryConfigSub', { defaultValue: '选择入口节点与端口，并设置协议' })}</div>
															</div>
														</div>
													</div>
													<div className="timeline-body">
														<div className="grid grid-cols-12 gap-3">
															<div className="col-span-12 md:col-span-5">
																<FieldGroup label={t('forward.entryNode', { defaultValue: '入口节点' })} required>
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
																				'w-full inline-flex items-center justify-between rounded-md px-3 py-2 text-sm border bg-white',
																				'hover:border-accent-7 transition-colors',
																				formDisabled ? 'opacity-60 cursor-not-allowed' : ''
																			].join(' ')}>
																			<span className={structured.entry_node_id ? 'text-(--gray-12)' : 'text-(--gray-9)'}>
																				{structured.entry_node_id
																					? (nodeMap[structured.entry_node_id] || structured.entry_node_id)
																					: t('forward.selectEntry', { defaultValue: '选择入口节点...' })}
																			</span>
																			<Server size={14} className="text-(--gray-9)" />
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
															<div className="col-span-12 md:col-span-3">
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
											</div>

											{/* 中继模式 */}
											{form.type === 'relay_group' && (
												<div className="timeline-step">
													<div className="timeline-dot relay">
														<Waypoints size={12} />
													</div>
													<div className="timeline-content">
														<div className="timeline-header">
															<div className="timeline-header-left">
																<div className="timeline-icon relay">
																	<Waypoints size={16} />
																</div>
																<div>
																	<div className="timeline-title">{t('forward.relayConfig', { defaultValue: '中继节点' })}</div>
																	<div className="timeline-subtitle">{t('forward.relayConfigSub', { defaultValue: '批量选择中继节点，并为每个节点设置端口与权重/优先级' })}</div>
																</div>
															</div>
														</div>
														<div className="timeline-body space-y-4">
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
												</div>
											)}

											{/* 链式模式：跳点 */}
											{form.type === 'chain' && (
												<>
													{structured.hops.length === 0 ? (
														<div className="timeline-step">
															<div className="timeline-dot hop">
																<Zap size={12} />
															</div>
															<div className="timeline-content">
																<div className="timeline-header">
																	<div className="timeline-header-left">
																		<div className="timeline-icon hop">
																			<Zap size={16} />
																		</div>
																		<div>
																			<div className="timeline-title">{t('forward.chainConfig', { defaultValue: '链路跳点' })}</div>
																			<div className="timeline-subtitle">{t('forward.noHops', { defaultValue: '暂无跳点，点击下方按钮添加' })}</div>
																		</div>
																	</div>
																</div>
																<div className="timeline-body">
																	<div className="py-6 text-center rounded-lg bg-slate-50 ring-1 ring-black/5">
																		<Zap size={24} className="mx-auto mb-2 text-slate-400" />
																		<Text size="2" color="gray">{t('forward.chainConfigSub', { defaultValue: '跳点会按顺序串联，流量依次经过每个跳点' })}</Text>
																	</div>
																	<Flex justify="center" gap="2" className="mt-4">
																		<Button
																			size="2"
																			variant="soft"
																			disabled={formDisabled}
																			onClick={() => setStructured(p => ({ ...p, hops: [...p.hops, { id: uid(), type: 'direct', node_id: '', port: '', current_port: 0 }] }))}>
																			<Plus size={14} /> {t('forward.addDirectHop', { defaultValue: '新增直连跳点' })}
																		</Button>
																		<Button
																			size="2"
																			variant="soft"
																			disabled={formDisabled}
																			onClick={() => setStructured(p => ({ ...p, hops: [...p.hops, { id: uid(), type: 'relay_group', relays: [], strategy: 'priority', active_relay_node_id: '' }] }))}>
																			<Plus size={14} /> {t('forward.addRelayHop', { defaultValue: '新增中继组跳点' })}
																		</Button>
																	</Flex>
																</div>
															</div>
														</div>
													) : (
														<>
															{structured.hops.map((hop, idx) => (
																<div key={hop.id} className="timeline-step">
																	<div className="timeline-dot hop">
																		{idx + 1}
																	</div>
																	<div className="timeline-content">
																		<div className="timeline-header">
																			<div className="timeline-header-left">
																				<div className="timeline-icon hop">
																					{hop.type === 'direct' ? <ArrowRight size={16} /> : <Waypoints size={16} />}
																				</div>
																				<div>
																					<div className="timeline-title">
																						{t('forward.hop', { defaultValue: '跳点' })} {idx + 1} · {hop.type === 'direct' ? t('forward.directHop', { defaultValue: '直连' }) : t('forward.relayGroup', { defaultValue: '中继组' })}
																					</div>
																					<div className="timeline-subtitle">
																						{hop.type === 'direct' ? t('forward.hopDirectSub', { defaultValue: '单节点直连转发' }) : t('forward.hopRelaySub', { defaultValue: '多节点负载均衡' })}
																					</div>
																				</div>
																			</div>
																			<Button size="1" variant="ghost" color="red" onClick={() => setStructured(p => ({ ...p, hops: p.hops.filter(h => h.id !== hop.id) }))} disabled={formDisabled}>
																				<Trash2 size={14} />
																			</Button>
																		</div>
																		<div className="timeline-body">
																			{hop.type === 'direct' ? (
																				<div className="grid grid-cols-12 gap-3">
																					<div className="col-span-12 md:col-span-6">
																						<FieldGroup label={t('forward.node', { defaultValue: '节点' })} required>
																							<NodeSelectorDialog
																								value={hop.node_id ? [hop.node_id] : []}
																								onChange={ids => {
																									updateHop(hop.id, h => ({ ...h, node_id: ids[0] || '' } as HopForm))
																									schedulePortCheck(`hop-${hop.id}`, ids[0] || '', hop.port)
																								}}
																								title={t('forward.targetNode')}
																								hiddenDescription
																								showViewModeToggle
																								disabled={formDisabled}
																								filterNode={linuxFilter}
																								excludeIds={excludeFor([hop.node_id])}
																								block>
																								<button
																									type="button"
																									disabled={formDisabled}
																									className={[
																										'w-full inline-flex items-center justify-between rounded-md px-3 py-2 text-sm border bg-white',
																										'hover:border-accent-7 transition-colors',
																										formDisabled ? 'opacity-60 cursor-not-allowed' : ''
																									].join(' ')}>
																									<span className={hop.node_id ? 'text-(--gray-12)' : 'text-(--gray-9)'}>
																										{hop.node_id ? (nodeMap[hop.node_id] || hop.node_id) : t('forward.selectNode', { defaultValue: '选择节点...' })}
																									</span>
																									<Server size={14} className="text-(--gray-9)" />
																								</button>
																							</NodeSelectorDialog>
																						</FieldGroup>
																					</div>
																					<div className="col-span-12 md:col-span-6">
																						<FieldGroup label={t('forward.port', { defaultValue: '端口' })} required>
																							<Flex gap="2" align="center">
																								<div className="flex-1 relative">
																									<TextField.Root
																										size="2"
																										value={hop.port}
																										onChange={e => {
																											updateHop(hop.id, h => ({ ...h, port: e.target.value } as HopForm))
																											schedulePortCheck(`hop-${hop.id}`, hop.node_id, e.target.value)
																										}}
																										placeholder="10000-20000"
																										disabled={formDisabled}
																									/>
																									<div className="absolute right-2 top-1/2 -translate-y-1/2">{renderPortStatus(`hop-${hop.id}`)}</div>
																								</div>
																								<Button size="1" variant="soft" onClick={() => checkPort(hop.node_id, hop.port, () => {})} disabled={formDisabled}>
																									{t('forward.checkPortNow', { defaultValue: '检查' })}
																								</Button>
																							</Flex>
																						</FieldGroup>
																					</div>
																				</div>
																			) : (
																				<div className="space-y-4">
																					<RelayEditor
																						relays={hop.relays}
																						strategy={hop.strategy}
																						onChange={r => updateHop(hop.id, h => ({ ...h, relays: r } as HopForm))}
																						disabled={formDisabled}
																						filterNode={linuxFilter}
																						excludeFor={excludeFor}
																						schedulePortCheck={(key, nodeId, portSpec) => schedulePortCheck(`hop-${hop.id}-${key}`, nodeId, portSpec)}
																						renderPortStatus={key => renderPortStatus(`hop-${hop.id}-${key}`)}
																						checkPort={checkPort}
																					/>
																					<FieldGroup label={t('forward.strategy', { defaultValue: '策略' })}>
																						<RadioGroup.Root
																							value={hop.strategy}
																							onValueChange={v => updateHop(hop.id, h => ({ ...h, strategy: v } as HopForm))}
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
																			)}
																		</div>
																	</div>
																</div>
															))}
															<Flex justify="center" gap="2" className="pt-2 pb-4">
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
														</>
													)}
												</>
											)}

											{/* 目标节点 */}
											<div className="timeline-step">
												<div className="timeline-dot target">
													<Target size={12} />
												</div>
												<div className="timeline-content">
													<div className="timeline-header">
														<div className="timeline-header-left">
															<div className="timeline-icon target">
																<Target size={16} />
															</div>
															<div>
																<div className="timeline-title">{t('forward.targetConfig', { defaultValue: '目标' })}</div>
																<div className="timeline-subtitle">{t('forward.targetConfigSub', { defaultValue: '选择目标节点或填写自定义目标地址与端口' })}</div>
															</div>
														</div>
													</div>
													<div className="timeline-body">
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
									</div>
								</div>

								{/* Realm 配置 */}
								<div className="route-card">
										<div className="route-card-header">
											<div>
												<div className="route-card-title">{t('forward.realmConfig', { defaultValue: 'Realm 配置' })}</div>
												<div className="route-card-subtitle">{t('forward.realmConfigSub', { defaultValue: '为入口/中继/跳点生成或手动编辑 realm 模板。' })}</div>
											</div>
											<Flex align="center" gap="3">
												{previewLoading && !manualRealmEdit && (
													<Text size="1" color="gray">{t('forward.previewLoading', { defaultValue: '正在生成预览…' })}</Text>
												)}
												<Flex align="center" gap="2" className="px-2 py-1 rounded-md bg-[var(--gray-2)] border">
													<Switch size="1" checked={manualRealmEdit} onCheckedChange={v => setManualRealmEdit(Boolean(v))} disabled={!realmNodes.length} />
													<Text size="2" color={manualRealmEdit ? 'amber' : 'gray'}>
														{manualRealmEdit ? t('forward.manualMode', { defaultValue: '手动' }) : t('forward.autoMode', { defaultValue: '自动' })}
													</Text>
												</Flex>
											</Flex>
										</div>
										<div className="route-card-body space-y-3">
											<div className="grid grid-cols-12 gap-3">
												<div className="col-span-12 md:col-span-6">
													<FieldGroup label={t('forward.selectNode', { defaultValue: '选择节点' })}>
														<Select.Root size="2" value={realmNode} onValueChange={setRealmNode} disabled={!realmNodes.length}>
															<Select.Trigger className="w-full" />
															<Select.Content position="popper">
																{realmNodes.map(n => <Select.Item key={n.id} value={n.id}>{n.label}</Select.Item>)}
															</Select.Content>
														</Select.Root>
													</FieldGroup>
												</div>
												<div className="col-span-12 md:col-span-6">
													<FieldGroup
														label={t('forward.realmModeHintTitle', { defaultValue: '说明' })}
														hint={manualRealmEdit
															? t('forward.manualRealmHint', { defaultValue: '手动模式下只保存你填写的内容；将会覆盖自动生成结果。' })
															: t('forward.autoRealmHint', { defaultValue: '自动模式将根据当前路由配置生成预览，保存后生效。' })}>
														<div className="h-[34px] flex items-center text-sm text-gray-11">
															{manualRealmEdit
																? t('forward.manualEditing', { defaultValue: '当前为手动编辑' })
																: t('forward.autoPreviewing', { defaultValue: '当前为自动预览' })}
														</div>
													</FieldGroup>
												</div>
											</div>
											<TextArea
												rows={10}
												value={activeRealmConfig}
												readOnly={!manualRealmEdit || !realmNode}
												onChange={e => realmNode && setRealmConfigs(p => ({ ...p, [realmNode]: e.target.value }))}
												placeholder={t('forward.realmConfigPlaceholder', { defaultValue: '# realm config (TOML)' })}
												className="font-mono text-xs leading-5 bg-[var(--gray-1)]"
											/>
										</div>
								</div>

								<div className="route-card">
									<div className="route-card-header">
										<div>
											<div className="route-card-title">{t('forward.alertConfig', { defaultValue: '告警配置' })}</div>
											<div className="route-card-subtitle">{t('forward.alertConfigSub', { defaultValue: '为该规则启用/配置告警项。' })}</div>
										</div>
										<Flex align="center" gap="2" className="px-2 py-1 rounded-md bg-gray-2 border">
											<Switch size="1" checked={alertConfig.enabled} onCheckedChange={v => setAlertConfig(c => ({ ...c, enabled: Boolean(v) }))} />
											<Text size="2" color={alertConfig.enabled ? 'green' : 'gray'}>
												{alertConfig.enabled ? t('forward.enabled', { defaultValue: '已启用' }) : t('forward.disabled', { defaultValue: '未启用' })}
											</Text>
										</Flex>
									</div>
									<div className="route-card-body">
										<AlertConfigCard value={alertConfig} onChange={setAlertConfig} collapsible={false} variant="embedded" hideEnableSwitch />
									</div>
								</div>

								<div className="route-card">
									<div className="route-card-header">
										<div>
											<div className="route-card-title">{t('forward.configPreview', { defaultValue: '配置预览' })}</div>
											<div className="route-card-subtitle">{t('forward.configPreviewSub', { defaultValue: '将要提交保存的结构化配置（JSON）。' })}</div>
										</div>
										<Button
											size="1"
											variant="soft"
											onClick={async () => {
												try { await navigator.clipboard.writeText(generatedPreview || '') }
												catch { /* ignore */ }
											}}>
											{t('common.copy', { defaultValue: '复制' })}
										</Button>
									</div>
									<div className="route-card-body">
										<TextArea rows={10} value={generatedPreview} readOnly className="font-mono text-xs leading-5 bg-[var(--gray-1)]" />
									</div>
								</div>

								</div>
							</div>

							{/* Footer */}
							<DrawerFooter className="px-6 py-3 border-t">
								<Flex justify="between" align="center">
									<DrawerClose asChild>
										<Button size="2" variant="soft" color="gray"><X size={16} /> {t('forward.cancel')}</Button>
									</DrawerClose>
									<Button size="2" variant="ghost" onClick={openTestConnectivity} disabled={saving}>
										<TestTube size={16} /> {t('forward.testConnectivity')}
									</Button>
									<Button size="2" onClick={handleSubmit} disabled={saving}>
										<Save size={16} /> {saving ? t('common.saving', { defaultValue: '保存中...' }) : t('forward.submit')}
									</Button>
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
		<div className="space-y-4">
			<FieldGroup label={t('forward.targetType', { defaultValue: '目标类型' })}>
				<RadioGroup.Root
					value={structured.target_type}
					onValueChange={v => setStructured(p => ({ ...p, target_type: v as 'node' | 'custom' }))}
					orientation="vertical"
					className="flex flex-wrap flex-row! gap-5!"
					disabled={disabled}>
					<RadioGroup.Item value="custom">{t('forward.customTarget', { defaultValue: '自定义地址' })}</RadioGroup.Item>
					<RadioGroup.Item value="node">{t('forward.nodeTarget', { defaultValue: '节点' })}</RadioGroup.Item>
				</RadioGroup.Root>
			</FieldGroup>
			<div className="grid grid-cols-12 gap-3">
				{structured.target_type === 'node' ? (
					<>
						<div className="col-span-12 md:col-span-7">
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
											'w-full inline-flex items-center justify-between rounded-md px-3 py-2 text-sm border bg-white',
											'hover:border-accent-7 transition-colors',
											disabled ? 'opacity-60 cursor-not-allowed' : ''
										].join(' ')}>
										<span className={structured.target_node_id ? 'text-(--gray-12)' : 'text-(--gray-9)'}>
											{structured.target_node_id
												? (nodeMap[structured.target_node_id] || structured.target_node_id)
												: t('forward.selectTarget', { defaultValue: '选择目标节点...' })}
										</span>
										<Server size={14} className="text-(--gray-9)" />
									</button>
								</NodeSelectorDialog>
							</FieldGroup>
						</div>
						<div className="col-span-12 md:col-span-5">
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
						<div className="col-span-12 md:col-span-7">
							<FieldGroup label={t('forward.targetHost')} required>
								<TextField.Root size="2" value={structured.target_host} onChange={e => setStructured(p => ({ ...p, target_host: e.target.value }))} placeholder="1.1.1.1 或 example.com" disabled={disabled} />
							</FieldGroup>
						</div>
						<div className="col-span-12 md:col-span-5">
							<FieldGroup label={t('forward.targetPort')} required>
								<TextField.Root size="2" value={structured.target_port} onChange={e => setStructured(p => ({ ...p, target_port: e.target.value }))} placeholder="53" disabled={disabled} />
							</FieldGroup>
						</div>
					</>
				)}
			</div>
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
