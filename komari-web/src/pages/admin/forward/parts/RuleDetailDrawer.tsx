import { Flex, Text, TextArea, Button, Select, Card, Badge, Grid, Separator } from '@radix-ui/themes'
import { useTranslation } from 'react-i18next'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Drawer, DrawerClose, DrawerContent, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { useIsMobile } from '@/hooks/use-mobile'
import type { ForwardRule } from '..'
import { useNodeDetails } from '@/contexts/NodeDetailsContext'
import { Server, ArrowRight, Waypoints, Link2, Code, Eye, Settings, Copy, CheckCircle } from 'lucide-react'

type Props = {
	rule: ForwardRule | null
	onClose: () => void
}

const RuleDetailDrawer = ({ rule, onClose }: Props) => {
	const { t } = useTranslation()
	const { nodeDetail } = useNodeDetails()
	const isMobile = useIsMobile()
	const [toml, setToml] = useState('')
	const [saving, setSaving] = useState(false)
	const [previewLoading, setPreviewLoading] = useState(false)
	const [nodeConfigs, setNodeConfigs] = useState<Record<string, string>>({})
	const [activeNode, setActiveNode] = useState('')
	const [copied, setCopied] = useState(false)

	useEffect(() => {
		setToml(rule?.realm_config || '')
	}, [rule])

	const parsedConfig = useMemo(() => {
		if (!rule?.config_json) return null
		try {
			return JSON.parse(rule.config_json)
		} catch {
			return null
		}
	}, [rule])

	const nodeMap = useMemo(() => {
		const map: Record<string, string> = {}
		for (const node of nodeDetail) {
			map[node.uuid] = node.name || node.uuid
		}
		return map
	}, [nodeDetail])

	const nodeOptions = useMemo(() => {
		const items: { id: string; label: string }[] = []
		const seen = new Set<string>()
		const push = (id: string, labelPrefix: string) => {
			if (!id || seen.has(id)) return
			seen.add(id)
			const name = nodeMap[id] || id
			items.push({ id, label: `${labelPrefix}: ${name}` })
		}
		if (parsedConfig?.entry_node_id) {
			push(parsedConfig.entry_node_id, t('forward.entry'))
		}
		for (const relay of parsedConfig?.relays || []) {
			push(relay.node_id, t('forward.relayNodes'))
		}
		for (const hop of parsedConfig?.hops || []) {
			if (hop.type === 'direct') {
				push(hop.node_id, t('forward.directHop'))
			} else if (hop.type === 'relay_group') {
				for (const relay of hop.relays || []) {
					push(relay.node_id, t('forward.relayGroup'))
				}
			}
		}
		return items
	}, [parsedConfig, nodeMap, t])

	useEffect(() => {
		if (!nodeOptions.length) {
			setActiveNode('')
			return
		}
		if (!nodeOptions.some(node => node.id === activeNode)) {
			setActiveNode(nodeOptions[0].id)
		}
	}, [nodeOptions, activeNode])

	useEffect(() => {
		const fetchPreview = async () => {
			if (!rule?.id || !rule.config_json) {
				setNodeConfigs({})
				return
			}
			setPreviewLoading(true)
			try {
				const res = await fetch('/api/v1/forwards/preview-config', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ type: rule.type, config_json: rule.config_json })
				})
				if (!res.ok) throw new Error(`HTTP ${res.status}`)
				const body = await res.json()
				setNodeConfigs(body.data?.node_configs || {})
			} catch (e: any) {
				setNodeConfigs({})
				toast.error(e?.message || 'Load preview failed')
			} finally {
				setPreviewLoading(false)
			}
		}
		fetchPreview()
	}, [rule])

	const saveToml = async () => {
		if (!rule?.id) return
		setSaving(true)
		try {
			let configJson: string | undefined
			if (rule.config_json) {
				try {
					const parsed = JSON.parse(rule.config_json)
					parsed.entry_realm_config = toml
					configJson = JSON.stringify(parsed, null, 2)
				} catch {
					configJson = undefined
				}
			}
			const res = await fetch(`/api/v1/forwards/${rule.id}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ realm_config: toml, ...(configJson ? { config_json: configJson } : {}) })
			})
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			toast.success(t('forward.templateSaved'))
		} catch (e: any) {
			toast.error(e?.message || 'Save failed')
		} finally {
			setSaving(false)
		}
	}

	const applyConfigs = async () => {
		if (!rule?.id) return
		try {
			const res = await fetch(`/api/v1/forwards/${rule.id}/apply-configs`, { method: 'POST' })
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			toast.success(t('forward.applyConfigsSuccess'))
		} catch (e: any) {
			toast.error(e?.message || t('forward.applyConfigsFailed'))
		}
	}

	const copyConfig = async () => {
		if (!rule?.config_json) return
		try {
			await navigator.clipboard.writeText(rule.config_json)
			setCopied(true)
			setTimeout(() => setCopied(false), 2000)
			toast.success(t('common.copied', { defaultValue: '已复制' }))
		} catch {
			toast.error(t('common.copyFailed', { defaultValue: '复制失败' }))
		}
	}

	const statusColor = (status?: string) => {
		const s = status?.toLowerCase()
		if (s === 'running') return 'green'
		if (s === 'error') return 'red'
		return 'gray'
	}

	const typeIcon = (type?: string) => {
		const t = type?.toLowerCase()
		if (t === 'direct') return <ArrowRight size={14} />
		if (t === 'relay_group') return <Waypoints size={14} />
		if (t === 'chain') return <Link2 size={14} />
		return <Server size={14} />
	}

	const typeColor = (type?: string) => {
		const t = type?.toLowerCase()
		if (t === 'direct') return 'blue'
		if (t === 'relay_group') return 'teal'
		if (t === 'chain') return 'orange'
		return 'gray'
	}

	// Parse entry and target info
	const entryInfo = useMemo(() => {
		if (!parsedConfig) return null
		const nodeId = parsedConfig.entry_node_id
		const nodeName = nodeMap[nodeId] || nodeId
		const port = parsedConfig.entry_current_port || parsedConfig.entry_port
		return { nodeName, nodeId, port, protocol: parsedConfig.protocol }
	}, [parsedConfig, nodeMap])

	const targetInfo = useMemo(() => {
		if (!parsedConfig) return null
		if (parsedConfig.target_type === 'node') {
			const nodeId = parsedConfig.target_node_id
			const nodeName = nodeMap[nodeId] || nodeId
			return { type: 'node', nodeName, nodeId, port: parsedConfig.target_port }
		}
		return { type: 'custom', host: parsedConfig.target_host, port: parsedConfig.target_port }
	}, [parsedConfig, nodeMap])

	return (
		<Drawer open={Boolean(rule)} onOpenChange={open => (!open ? onClose() : null)} direction={isMobile ? 'bottom' : 'right'}>
			<DrawerContent className={isMobile ? 'max-h-[90vh]' : 'w-[600px] sm:max-w-[600px]'}>
				<DrawerHeader className="border-b pb-4">
					<Flex justify="between" align="start">
						<div>
							<DrawerTitle className="text-xl flex items-center gap-2">
								<Eye size={20} /> {rule?.name || t('forward.ruleDetail', { defaultValue: '规则详情' })}
							</DrawerTitle>
							<Flex gap="2" mt="2" align="center">
								<Badge color={statusColor(rule?.status)}>
									{rule?.status === 'running' ? t('forward.statusRunning') : rule?.status === 'error' ? t('forward.statusError') : t('forward.statusStopped')}
								</Badge>
								<Badge color={typeColor(rule?.type) as any} variant="soft">
									{typeIcon(rule?.type)}
									<span className="ml-1">
										{rule?.type === 'direct' ? t('forward.typeDirect') : rule?.type === 'relay_group' ? t('forward.typeRelayGroup') : t('forward.typeChain')}
									</span>
								</Badge>
							</Flex>
						</div>
					</Flex>
				</DrawerHeader>

				<div className="flex-1 overflow-y-auto px-4 py-4">
					<div className="space-y-4">
						{/* Basic Info */}
						<Card className="p-4">
							<Text size="2" weight="bold" className="mb-3 flex items-center gap-2">
								<Server size={16} /> {t('forward.basicInfo', { defaultValue: '基本信息' })}
							</Text>
							<Grid columns="2" gap="3">
								<div>
									<Text size="1" color="gray">{t('forward.group')}</Text>
									<Text size="2" className="block mt-1">{rule?.group_name || '-'}</Text>
								</div>
								<div>
									<Text size="1" color="gray">{t('forward.protocol', { defaultValue: '协议' })}</Text>
									<Text size="2" className="block mt-1">{entryInfo?.protocol?.toUpperCase() || '-'}</Text>
								</div>
								{rule?.notes && (
									<div className="col-span-2">
										<Text size="1" color="gray">{t('forward.notes')}</Text>
										<Text size="2" className="block mt-1">{rule.notes}</Text>
									</div>
								)}
							</Grid>
						</Card>

						{/* Route Overview */}
						{entryInfo && targetInfo && (
							<Card className="p-4">
								<Text size="2" weight="bold" className="mb-3 flex items-center gap-2">
									<Waypoints size={16} /> {t('forward.routeOverview', { defaultValue: '路由概览' })}
								</Text>
								<div className="flex items-center gap-3 flex-wrap">
									<Badge size="2" color="blue" variant="soft" className="py-2 px-3">
										<Server size={14} className="mr-1" />
										{entryInfo.nodeName}:{entryInfo.port}
									</Badge>
									<ArrowRight size={16} className="text-gray-8" />
									{rule?.type === 'relay_group' && parsedConfig?.relays?.length > 0 && (
										<>
											<Badge size="2" color="teal" variant="soft" className="py-2 px-3">
												<Waypoints size={14} className="mr-1" />
												{parsedConfig.relays.length} {t('forward.relayNodes')}
											</Badge>
											<ArrowRight size={16} className="text-gray-8" />
										</>
									)}
									{rule?.type === 'chain' && parsedConfig?.hops?.length > 0 && (
										<>
											<Badge size="2" color="orange" variant="soft" className="py-2 px-3">
												<Link2 size={14} className="mr-1" />
												{parsedConfig.hops.length} {t('forward.hops', { defaultValue: '跳' })}
											</Badge>
											<ArrowRight size={16} className="text-gray-8" />
										</>
									)}
									<Badge size="2" color="green" variant="soft" className="py-2 px-3">
										{targetInfo.type === 'node' ? (
											<><Server size={14} className="mr-1" />{targetInfo.nodeName}:{targetInfo.port}</>
										) : (
											<>{targetInfo.host}:{targetInfo.port}</>
										)}
									</Badge>
								</div>
							</Card>
						)}

						{/* Config JSON */}
						<Card className="p-4">
							<Flex justify="between" align="center" className="mb-3">
								<Text size="2" weight="bold" className="flex items-center gap-2">
									<Code size={16} /> {t('forward.configJson', { defaultValue: '配置 JSON' })}
								</Text>
								<Button variant="ghost" size="1" onClick={copyConfig}>
									{copied ? <CheckCircle size={14} /> : <Copy size={14} />}
									<span className="ml-1">{copied ? t('common.copied', { defaultValue: '已复制' }) : t('common.copy', { defaultValue: '复制' })}</span>
								</Button>
							</Flex>
							<div className="bg-gray-2 rounded-lg p-3 overflow-auto max-h-48">
								<pre className="text-xs font-mono whitespace-pre-wrap break-all">
									{rule?.config_json ? JSON.stringify(JSON.parse(rule.config_json), null, 2) : t('forward.configPlaceholder')}
								</pre>
							</div>
						</Card>

						{/* Node Configs Preview */}
						{nodeOptions.length > 0 && (
							<Card className="p-4">
								<Flex justify="between" align="center" className="mb-3">
									<Text size="2" weight="bold" className="flex items-center gap-2">
										<Settings size={16} /> {t('forward.previewConfig')}
									</Text>
									<Button variant="soft" size="1" onClick={applyConfigs} disabled={rule?.status !== 'running'}>
										{t('forward.applyConfigs')}
									</Button>
								</Flex>
								<div className="space-y-3">
									<Select.Root value={activeNode} onValueChange={setActiveNode}>
										<Select.Trigger className="w-full" placeholder={t('forward.selectNode')} />
										<Select.Content>
											{nodeOptions.map(node => (
												<Select.Item key={node.id} value={node.id}>
													{node.label}
												</Select.Item>
											))}
										</Select.Content>
									</Select.Root>
									{previewLoading && (
										<Text size="1" color="gray">
											{t('forward.previewLoading')}
										</Text>
									)}
									<TextArea
										rows={8}
										value={nodeConfigs[activeNode] || ''}
										readOnly
										className="font-mono text-xs"
										placeholder={t('forward.noConfigPreview', { defaultValue: '暂无配置预览' })}
									/>
								</div>
							</Card>
						)}

						{/* Realm TOML Editor */}
						<Card className="p-4">
							<Text size="2" weight="bold" className="mb-3 flex items-center gap-2">
								<Code size={16} /> Realm TOML
							</Text>
							<TextArea
								rows={10}
								value={toml}
								onChange={e => setToml(e.target.value)}
								className="font-mono text-xs"
								placeholder={t('forward.realmConfigPlaceholder', { defaultValue: '输入 Realm TOML 配置...' })}
							/>
							<Flex justify="end" gap="2" mt="3">
								<Button variant="soft" size="2" onClick={() => setToml(rule?.realm_config || '')}>
									{t('common.reset', { defaultValue: '重置' })}
								</Button>
								<Button size="2" onClick={saveToml} disabled={saving}>
									{saving ? t('common.saving', { defaultValue: '保存中...' }) : t('forward.save', { defaultValue: '保存' })}
								</Button>
							</Flex>
						</Card>

						{/* Statistics */}
						{(rule?.total_connections !== undefined || rule?.total_traffic_in !== undefined) && (
							<Card className="p-4">
								<Text size="2" weight="bold" className="mb-3">{t('forward.statistics', { defaultValue: '统计信息' })}</Text>
								<Grid columns="3" gap="4">
									<div className="text-center">
										<Text size="5" weight="bold" className="block">{rule?.total_connections ?? 0}</Text>
										<Text size="1" color="gray">{t('chart.connections')}</Text>
									</div>
									<div className="text-center">
										<Text size="5" weight="bold" className="block">{formatBytes(rule?.total_traffic_in)}</Text>
										<Text size="1" color="gray">{t('forward.trafficIn', { defaultValue: '入流量' })}</Text>
									</div>
									<div className="text-center">
										<Text size="5" weight="bold" className="block">{formatBytes(rule?.total_traffic_out)}</Text>
										<Text size="1" color="gray">{t('forward.trafficOut', { defaultValue: '出流量' })}</Text>
									</div>
								</Grid>
							</Card>
						)}
					</div>
				</div>

				<DrawerFooter className="border-t pt-4">
					<DrawerClose asChild>
						<Button variant="soft" color="gray" className="w-full">
							{t('common.close', { defaultValue: '关闭' })}
						</Button>
					</DrawerClose>
				</DrawerFooter>
			</DrawerContent>
		</Drawer>
	)
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

export default RuleDetailDrawer
