import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button, Card, Flex, Select, Tabs, Text, TextField } from '@radix-ui/themes'
import { ChevronDownIcon, PlusIcon, ReloadIcon } from '@radix-ui/react-icons'
import { useNavigate } from 'react-router-dom'

import RuleTable from './parts/RuleTable'
import RuleFormDrawer, { type RuleFormState } from './parts/RuleFormDrawer'
import RuleDetailDrawer from './parts/RuleDetailDrawer'
import SettingsPanel from './parts/SettingsPanel'
import TemplateEditor from './parts/TemplateEditor'
import TestConnectivityDialog from './parts/TestConnectivityDialog'
import RuleLogsDialog from './parts/RuleLogsDialog'
import Loading from '@/components/loading'
import { NodeDetailsProvider } from '@/contexts/NodeDetailsContext'

export type ForwardRule = {
	id: number
	is_enabled: boolean
	name: string
	group_name: string
	sort_order?: number
	tags?: string
	notes?: string
	type: string
	status: string
	config_json: string
	realm_config?: string
	total_connections?: number
	total_traffic_in?: number
	total_traffic_out?: number
	updated_at?: string
}

const defaultForm: RuleFormState = {
	name: '',
	group_name: '',
	tags: '',
	notes: '',
	type: 'direct',
	is_enabled: true,
	config_json: ''
}

const parseTags = (raw?: string) => {
	if (!raw) return [] as string[]
	try {
		const parsed = JSON.parse(raw)
		if (Array.isArray(parsed)) {
			return parsed.map(item => String(item)).filter(Boolean)
		}
	} catch {
		// ignore
	}
	return raw
		.split(',')
		.map(item => item.trim())
		.filter(Boolean)
}

const serializeTags = (raw?: string) => {
	const tags = parseTags(raw)
	return JSON.stringify(tags)
}

const ForwardPage = () => {
	const { t } = useTranslation()
	const navigate = useNavigate()
	const [rules, setRules] = useState<ForwardRule[]>([])
	const [loading, setLoading] = useState(false)
	const [formOpen, setFormOpen] = useState(false)
	const [editing, setEditing] = useState<RuleFormState | null>(null)
	const [detail, setDetail] = useState<ForwardRule | null>(null)
	const [testRule, setTestRule] = useState<ForwardRule | null>(null)
	const [logRule, setLogRule] = useState<ForwardRule | null>(null)
	const [search, setSearch] = useState('')
	const [statusFilter, setStatusFilter] = useState('all')
	const [typeFilter, setTypeFilter] = useState('all')
	const [selectedIds, setSelectedIds] = useState<number[]>([])
	const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})

	const fetchRules = async (opts?: { silent?: boolean }) => {
		if (!opts?.silent) setLoading(true)
		try {
			const res = await fetch('/api/v1/forwards')
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			const body = await res.json()
			setRules(body.data || [])
		} catch (e: any) {
			if (!opts?.silent) toast.error(e?.message || 'Load failed')
		} finally {
			if (!opts?.silent) setLoading(false)
		}
	}

	useEffect(() => {
		fetchRules()
	}, [])

	// WebSocket：接收转发配置同步等事件，自动刷新列表
	useEffect(() => {
		const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
		const wsUrl = `${protocol}//${window.location.host}/api/v1/forwards/ws`
		const ws = new WebSocket(wsUrl)
		let timer: number | undefined

		const scheduleRefresh = () => {
			if (timer) return
			timer = window.setTimeout(() => {
				timer = undefined
				fetchRules({ silent: true })
			}, 500)
		}

		ws.onmessage = evt => {
			try {
				const msg = JSON.parse(evt.data)
				if (msg?.event === 'forward_config_updated') {
					scheduleRefresh()
				}
			} catch {
				// ignore
			}
		}

		ws.onerror = () => {
			// ignore
		}

		return () => {
			if (timer) window.clearTimeout(timer)
			ws.close()
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [])

	const handleSave = async (data: RuleFormState) => {
		const payload = {
			name: data.name,
			group_name: data.group_name,
			tags: serializeTags(data.tags),
			notes: data.notes,
			type: data.type,
			is_enabled: data.is_enabled,
			config_json: data.config_json,
			status: data.id ? undefined : 'stopped'
		}
		try {
			if (data.id) {
				const res = await fetch(`/api/v1/forwards/${data.id}`, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(payload)
				})
				if (!res.ok) throw new Error(`HTTP ${res.status}`)
				toast.success(t('forward.updated'))
			} else {
				const res = await fetch('/api/v1/forwards', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(payload)
				})
				if (!res.ok) throw new Error(`HTTP ${res.status}`)
				toast.success(t('forward.created'))
			}
			setFormOpen(false)
			setEditing(null)
			fetchRules()
		} catch (e: any) {
			toast.error(e?.message || 'Save failed')
		}
	}

	const updateState = async (id: number, path: 'start' | 'stop' | 'enable' | 'disable') => {
		try {
			const res = await fetch(`/api/v1/forwards/${id}/${path}`, { method: 'POST' })
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			toast.success(t('common.success'))
			fetchRules()
		} catch (e: any) {
			toast.error(e?.message || 'Operation failed')
		}
	}

	const handleDelete = async (rule: ForwardRule) => {
		if (!window.confirm(t('forward.deleteConfirm', { defaultValue: '确认删除该规则？' }))) return
		try {
			const res = await fetch(`/api/v1/forwards/${rule.id}`, { method: 'DELETE' })
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			toast.success(t('forward.deleted'))
			fetchRules()
		} catch (e: any) {
			toast.error(e?.message || 'Delete failed')
		}
	}

	const handleExport = (rule: ForwardRule) => {
		const content = rule.config_json || '{}'
		const blob = new Blob([content], { type: 'application/json' })
		const url = URL.createObjectURL(blob)
		const link = document.createElement('a')
		link.href = url
		link.download = `forward-${rule.id}.json`
		link.click()
		URL.revokeObjectURL(url)
	}

	const toggleSelect = (id: number, checked: boolean) => {
		setSelectedIds(prev => (checked ? Array.from(new Set([...prev, id])) : prev.filter(item => item !== id)))
	}

	const toggleSelectAll = (ids: number[], checked: boolean) => {
		setSelectedIds(prev => (checked ? Array.from(new Set([...prev, ...ids])) : prev.filter(id => !ids.includes(id))))
	}

	const runBatch = async (action: 'enable' | 'disable' | 'delete') => {
		if (selectedIds.length === 0) return
		if (action === 'delete' && !window.confirm(t('forward.deleteConfirmBatch', { defaultValue: '确认删除选中规则？' }))) {
			return
		}
		try {
			await Promise.all(
				selectedIds.map(async id => {
					const endpoint = action === 'delete' ? `/api/v1/forwards/${id}` : `/api/v1/forwards/${id}/${action}`
					const res = await fetch(endpoint, { method: action === 'delete' ? 'DELETE' : 'POST' })
					if (!res.ok) throw new Error(`HTTP ${res.status}`)
				})
			)
			toast.success(t('common.success'))
			setSelectedIds([])
			fetchRules()
		} catch (e: any) {
			toast.error(e?.message || 'Batch failed')
		}
	}

	const handleReorder = async (ordered: ForwardRule[]) => {
		const updates = ordered.map((rule, idx) => ({ id: rule.id, sort_order: (idx + 1) * 10 }))
		setRules(prev =>
			prev.map(rule => {
				const update = updates.find(item => item.id === rule.id)
				return update ? { ...rule, sort_order: update.sort_order } : rule
			})
		)
		try {
			await Promise.all(
				updates.map(async update => {
					const res = await fetch(`/api/v1/forwards/${update.id}`, {
						method: 'PUT',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ sort_order: update.sort_order })
					})
					if (!res.ok) throw new Error(`HTTP ${res.status}`)
				})
			)
			toast.success(t('forward.sortSaved', { defaultValue: '排序已保存' }))
		} catch (e: any) {
			toast.error(e?.message || 'Sort failed')
			fetchRules()
		}
	}

	const filteredRules = useMemo(() => {
		const keyword = search.trim().toLowerCase()
		return rules.filter(rule => {
			if (statusFilter !== 'all' && rule.status !== statusFilter) return false
			if (typeFilter !== 'all' && rule.type !== typeFilter) return false
			if (!keyword) return true
			const tags = parseTags(rule.tags)
			return (
				rule.name?.toLowerCase().includes(keyword) ||
				rule.group_name?.toLowerCase().includes(keyword) ||
				tags.some(tag => tag.toLowerCase().includes(keyword))
			)
		})
	}, [rules, search, statusFilter, typeFilter])

	const groupedRules = useMemo(() => {
		const groups: Record<string, ForwardRule[]> = {}
		for (const rule of filteredRules) {
			const key = rule.group_name?.trim() || t('forward.ungrouped', { defaultValue: '未分组' })
			if (!groups[key]) groups[key] = []
			groups[key].push(rule)
		}
		return Object.entries(groups)
			.map(([group, items]) => {
				const sorted = [...items].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.id - b.id)
				return { group, items: sorted }
			})
			.sort((a, b) => a.group.localeCompare(b.group))
	}, [filteredRules, t])

	const allowDrag = search.trim() === '' && statusFilter === 'all' && typeFilter === 'all'

	return (
		<NodeDetailsProvider>
			<Flex direction="column" gap="4" className="p-4">
				<Flex justify="between" align="center">
					<Text size="6" weight="bold">
						{t('forward.title')}
					</Text>
					<Flex gap="2">
						<Button variant="ghost" onClick={fetchRules} disabled={loading}>
							<ReloadIcon /> {t('forward.refresh')}
						</Button>
						<Button onClick={() => setFormOpen(true)}>
							<PlusIcon /> {t('forward.create')}
						</Button>
					</Flex>
				</Flex>

				<Tabs.Root defaultValue="list">
					<Tabs.List>
						<Tabs.Trigger value="list">{t('forward.tabList')}</Tabs.Trigger>
						<Tabs.Trigger value="settings">{t('forward.tabSettings')}</Tabs.Trigger>
						<Tabs.Trigger value="template">{t('forward.tabTemplate')}</Tabs.Trigger>
					</Tabs.List>
					<Tabs.Content value="list" className="pt-3">
						<Card className="p-3 mb-3">
							<Flex gap="3" align="center" wrap="wrap">
								<TextField.Root
									value={search}
									onChange={e => setSearch(e.target.value)}
									placeholder={t('forward.searchPlaceholder', { defaultValue: '搜索名称或标签' })}
								/>
								<Select.Root value={statusFilter} onValueChange={setStatusFilter}>
									<Select.Trigger placeholder={t('forward.filterStatus', { defaultValue: '状态' })} />
									<Select.Content>
										<Select.Item value="all">{t('forward.filterAll', { defaultValue: '全部状态' })}</Select.Item>
										<Select.Item value="running">{t('forward.statusRunning', { defaultValue: '运行中' })}</Select.Item>
										<Select.Item value="stopped">{t('forward.statusStopped', { defaultValue: '已停止' })}</Select.Item>
										<Select.Item value="error">{t('forward.statusError', { defaultValue: '异常' })}</Select.Item>
									</Select.Content>
								</Select.Root>
								<Select.Root value={typeFilter} onValueChange={setTypeFilter}>
									<Select.Trigger placeholder={t('forward.filterType', { defaultValue: '类型' })} />
									<Select.Content>
										<Select.Item value="all">{t('forward.filterAllType', { defaultValue: '全部类型' })}</Select.Item>
										<Select.Item value="direct">{t('forward.typeDirect', { defaultValue: '中转' })}</Select.Item>
										<Select.Item value="relay_group">{t('forward.typeRelayGroup', { defaultValue: '中继组' })}</Select.Item>
										<Select.Item value="chain">{t('forward.typeChain', { defaultValue: '链式' })}</Select.Item>
									</Select.Content>
								</Select.Root>
							</Flex>
						</Card>

						{selectedIds.length > 0 && (
							<Card className="p-3 mb-3">
								<Flex justify="between" align="center" wrap="wrap" gap="2">
									<Text>{t('forward.selectedCount', { defaultValue: '已选择 {{count}} 项', count: selectedIds.length })}</Text>
									<Flex gap="2" align="center">
										<Button size="2" variant="soft" onClick={() => runBatch('enable')}>
											{t('forward.batchEnable', { defaultValue: '批量启用' })}
										</Button>
										<Button size="2" variant="soft" onClick={() => runBatch('disable')}>
											{t('forward.batchDisable', { defaultValue: '批量停用' })}
										</Button>
										<Button size="2" variant="soft" color="red" onClick={() => runBatch('delete')}>
											{t('forward.batchDelete', { defaultValue: '批量删除' })}
										</Button>
										<Button size="2" variant="ghost" onClick={() => setSelectedIds([])}>
											{t('forward.clearSelection', { defaultValue: '清空选择' })}
										</Button>
									</Flex>
								</Flex>
							</Card>
						)}

						{loading ? (
							<Loading />
						) : groupedRules.length === 0 ? (
							<Card className="p-6 text-center">
								<Text size="3" weight="bold">
									{t('forward.emptyTitle', { defaultValue: '暂无转发规则' })}
								</Text>
								<Text size="2" color="gray" className="mt-2">
									{t('forward.emptyHint', { defaultValue: '创建第一个转发规则以开始使用。' })}
								</Text>
								<Button className="mt-4" onClick={() => setFormOpen(true)}>
									{t('forward.createFirst', { defaultValue: '创建第一个转发规则' })}
								</Button>
							</Card>
						) : (
							<Flex direction="column" gap="4">
								{groupedRules.map(group => {
									const collapsed = collapsedGroups[group.group]
									const groupIds = group.items.map(item => item.id)
									return (
										<Card key={group.group} className="p-3">
											<Flex justify="between" align="center" mb="3">
												<Button
													variant="ghost"
													onClick={() =>
														setCollapsedGroups(prev => ({ ...prev, [group.group]: !collapsed }))
													}>
													<ChevronDownIcon className={collapsed ? '' : 'rotate-180 transition-transform'} />
													{group.group} ({group.items.length})
												</Button>
											</Flex>
											{!collapsed && (
												<RuleTable
													rules={group.items}
													onView={setDetail}
													onEdit={rule => {
														setEditing({
															id: rule.id,
															name: rule.name,
															group_name: rule.group_name,
															tags: parseTags(rule.tags).join(', '),
															notes: rule.notes || '',
															type: rule.type,
															is_enabled: rule.is_enabled,
															config_json: rule.config_json
														})
														setFormOpen(true)
													}}
													onStart={id => updateState(id, 'start')}
													onStop={id => updateState(id, 'stop')}
													onToggleEnable={(id, enabled) => updateState(id, enabled ? 'enable' : 'disable')}
													onMonitor={id => navigate(`/admin/forward/${id}/dashboard`)}
													onTest={rule => setTestRule(rule)}
													onLogs={rule => setLogRule(rule)}
													onDelete={handleDelete}
													onExport={handleExport}
													draggable={allowDrag}
													onReorder={handleReorder}
													selectedIds={selectedIds}
													onToggleSelect={toggleSelect}
													onToggleSelectAll={checked => toggleSelectAll(groupIds, checked)}
												/>
											)}
										</Card>
									)
								})}
							</Flex>
						)}
					</Tabs.Content>
					<Tabs.Content value="settings" className="pt-3">
						<SettingsPanel />
					</Tabs.Content>
					<Tabs.Content value="template" className="pt-3">
						<TemplateEditor />
					</Tabs.Content>
				</Tabs.Root>

				<RuleFormDrawer
					open={formOpen}
					initial={editing ?? defaultForm}
					onClose={() => {
						setFormOpen(false)
						setEditing(null)
					}}
					onSubmit={handleSave}
				/>

				<RuleDetailDrawer rule={detail} onClose={() => setDetail(null)} />
				<TestConnectivityDialog open={!!testRule} ruleId={testRule?.id} onClose={() => setTestRule(null)} />
				<RuleLogsDialog open={!!logRule} ruleId={logRule?.id} onClose={() => setLogRule(null)} />
			</Flex>
		</NodeDetailsProvider>
	)
}

export default ForwardPage
