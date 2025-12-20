import React, { useEffect, useMemo, useState } from 'react'
import { NodeDetailsProvider, useNodeDetails } from '@/contexts/NodeDetailsContext'
import { Badge, Button, Card, Dialog, Flex, ScrollArea, Separator, Text, TextField, Tabs, Box, Checkbox } from '@radix-ui/themes'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Plus, RefreshCw, Save, Settings, Pencil, Trash2, Terminal, Shield, Code, Copy, CheckCircle2, Calendar, Hash, Globe2, KeyRound } from 'lucide-react'
import { toast } from 'sonner'
import Flag from '@/components/Flag'
import { Selector } from '@/components/Selector'
import { compareServersByWeightName } from '@/utils/serverSort'

type LgAuthorization = {
	id?: number
	name: string
	remark?: string
	mode: 'public' | 'code'
	code?: string
	nodes: string[]
	tools: string[]
	expires_at?: string | null
	max_usage?: number | null
	used_count?: number
}

type LgToolSetting = {
	id?: number
	tool: string
	command_template: string
	timeout_seconds: number
}

const TOOL_OPTIONS = ['ping', 'tcping', 'mtr', 'nexttrace', 'iperf3', 'speedtest']

const ACCESS_MODE_OPTIONS: Array<{
	value: 'public' | 'code'
	title: string
	desc: string
	icon: typeof Globe2
}> = [
	{
		value: 'public',
		title: '公开访问',
		desc: '无需授权码即可访问',
		icon: Globe2
	},
	{
		value: 'code',
		title: '授权码访问',
		desc: '输入授权码后才可使用',
		icon: KeyRound
	}
]

const INSTALL_GUIDES = [
	{
		name: 'Ping',
		desc: 'ICMP 网络连通性测试工具',
		cmd: '通常系统自带,无需安装',
		preinstalled: true
	},
	{
		name: 'Tcping',
		desc: 'TCP 端口连通性测试工具',
		cmd: 'bash <(wget -qO- https://raw.githubusercontent.com/nodeseeker/tcping/main/install.sh) --force'
	},
	{
		name: 'MTR',
		desc: '网络路由跟踪与诊断工具',
		cmd: 'apt install mtr -y  # Debian/Ubuntu\n\nyum install mtr -y  # CentOS/RHEL'
	},
	{
		name: 'Nexttrace',
		desc: '现代化路由追踪工具',
		cmd: 'bash <(wget -qO- nxtrace.org/nt)'
	},
	{
		name: 'Iperf3',
		desc: '网络带宽测试工具',
		cmd: 'apt install iperf3 -y  # Debian/Ubuntu\n\nyum install iperf3 -y  # CentOS/RHEL'
	},
	{
		name: 'Speedtest',
		desc: 'Ookla 官方速度测试工具',
		cmd: 'bash <(wget -qO- https://packagecloud.io/install/repositories/ookla/speedtest-cli/script.deb.sh) && apt-get install -y speedtest'
	}
]

const LgPage = () => (
	<NodeDetailsProvider>
		<LgContent />
	</NodeDetailsProvider>
)

const LgContent = () => {
	const { nodeDetail, isLoading } = useNodeDetails()
	const [authList, setAuthList] = useState<LgAuthorization[]>([])
	const [toolSettings, setToolSettings] = useState<LgToolSetting[]>([])
	const [loading, setLoading] = useState(false)
	const [authDialogOpen, setAuthDialogOpen] = useState(false)
	const [editing, setEditing] = useState<LgAuthorization | null>(null)
	const [copiedCode, setCopiedCode] = useState<string | null>(null)

	const linuxNodes = useMemo(() => nodeDetail.filter(n => n.os && n.os.toLowerCase().includes('linux')), [nodeDetail])
	const linuxNodeIdSet = useMemo(() => new Set(linuxNodes.map(n => n.uuid)), [linuxNodes])

	const normalizeSelectedNodes = (nodes: string[]) => {
		const unique = Array.from(new Set((nodes || []).filter(Boolean)))
		// 节点列表未加载完成时，不做过滤，避免误清空导致无法保存/误提示
		if (linuxNodeIdSet.size === 0) return { valid: unique, orphan: [] as string[] }
		const valid = unique.filter(id => linuxNodeIdSet.has(id))
		const orphan = unique.filter(id => !linuxNodeIdSet.has(id))
		return { valid, orphan }
	}

	const refreshAll = async () => {
		setLoading(true)
		try {
			const [authResp, toolResp] = await Promise.all([fetch('/api/admin/lg/authorization'), fetch('/api/admin/lg/tool-setting')])
			if (authResp.ok) {
				const data = await authResp.json()
				setAuthList(data.data || data)
			}
			if (toolResp.ok) {
				const data = await toolResp.json()
				setToolSettings(data.data || data)
			}
		} catch (err) {
			console.error(err)
			toast.error('加载失败')
		} finally {
			setLoading(false)
		}
	}

	useEffect(() => {
		refreshAll()
	}, [])

	const openCreate = () => {
		setEditing({
			name: '',
			remark: '',
			mode: 'public',
			code: '',
			nodes: [],
			tools: ['ping'],
			expires_at: null,
			max_usage: null
		})
		setAuthDialogOpen(true)
	}

	const openEdit = (item: LgAuthorization) => {
		const { valid, orphan } = normalizeSelectedNodes(item.nodes || [])
		if (orphan.length > 0) {
			const preview = orphan.slice(0, 3).join(', ')
			toast.warning(`已自动移除 ${orphan.length} 个已删除/不可用节点${preview ? `：${preview}${orphan.length > 3 ? '…' : ''}` : ''}`)
		}
		setEditing({ ...item, nodes: valid })
		setAuthDialogOpen(true)
	}

	const saveAuth = async () => {
		if (!editing) return
		if (!editing.name.trim()) {
			toast.error('名称必填')
			return
		}
		const { valid: normalizedNodes, orphan } = normalizeSelectedNodes(editing.nodes || [])
		if (orphan.length > 0) {
			setEditing(prev => (prev ? { ...prev, nodes: normalizedNodes } : prev))
			toast.warning(`检测到 ${orphan.length} 个已删除/不可用节点，已自动移除后保存`)
		}
		if (!normalizedNodes.length) {
			toast.error('请至少选择一个节点')
			return
		}
		const body = {
			...editing,
			nodes: normalizedNodes,
			expires_at: editing.expires_at || null,
			max_usage: editing.max_usage ? Number(editing.max_usage) : null
		}
		const url = editing.id && editing.id > 0 ? '/api/admin/lg/authorization/update' : '/api/admin/lg/authorization'
		const resp = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		})
		if (resp.ok) {
			toast.success('已保存')
			setAuthDialogOpen(false)
			setEditing(null)
			refreshAll()
		} else {
			const data = await resp.json().catch(() => ({}))
			toast.error(data?.message || '保存失败')
		}
	}

	const deleteAuth = async (id?: number) => {
		if (!id) return
		if (!window.confirm('确认删除该授权?')) return
		const resp = await fetch('/api/admin/lg/authorization/delete', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id })
		})
		if (resp.ok) {
			toast.success('已删除')
			refreshAll()
		} else {
			toast.error('删除失败')
		}
	}

	const saveToolSettings = async () => {
		const resp = await fetch('/api/admin/lg/tool-setting', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ settings: toolSettings })
		})
		if (resp.ok) {
			toast.success('工具配置已保存')
			refreshAll()
		} else {
			toast.error('保存失败')
		}
	}

	const copyToClipboard = async (text: string, id: string) => {
		try {
			await navigator.clipboard.writeText(text)
			setCopiedCode(id)
			toast.success('已复制到剪贴板')
			setTimeout(() => setCopiedCode(null), 2000)
		} catch (err) {
			toast.error('复制失败')
		}
	}

	return (
		<Flex direction="column" gap="4" className="p-4">
			{/* 页面标题 */}
			<Flex justify="between" align="center">
				<div>
					<h1 className="text-2xl font-bold">Looking Glass 管理</h1>
					<Text size="2" color="gray" className="mt-1">
						管理公开/授权码访问、配置工具模板、查看安装指引
					</Text>
				</div>
				<Flex gap="2">
					<Button variant="soft" onClick={refreshAll} disabled={loading || isLoading}>
						<RefreshCw size={16} />
						刷新
					</Button>
					<Button onClick={openCreate}>
						<Plus size={16} />
						新增授权
					</Button>
				</Flex>
			</Flex>

			<Separator size="4" />

			{/* Tabs 区域 */}
			<Tabs.Root defaultValue="authorizations">
				<Tabs.List>
					<Tabs.Trigger value="authorizations">
						<Shield size={14} />
						授权列表
					</Tabs.Trigger>
					<Tabs.Trigger value="tools">
						<Settings size={14} />
						工具配置
					</Tabs.Trigger>
					<Tabs.Trigger value="install">
						<Terminal size={14} />
						安装指引
					</Tabs.Trigger>
				</Tabs.List>

				<Box pt="4">
					{/* 授权列表 Tab */}
					<Tabs.Content value="authorizations">
						<div className="overflow-x-auto">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead className="min-w-40">名称</TableHead>
										<TableHead className="min-w-[140px]">访问模式</TableHead>
										<TableHead>节点</TableHead>
										<TableHead className="min-w-[180px]">可用工具</TableHead>
										<TableHead>到期时间</TableHead>
										<TableHead>使用次数</TableHead>
										<TableHead className="min-w-[140px]">操作</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{authList.map(item => (
										<TableRow key={item.id}>
											<TableCell>
												<div className="font-semibold text-(--gray-12)">{item.name}</div>
												{item.remark && <div className="text-xs text-(--gray-10) mt-0.5">{item.remark}</div>}
											</TableCell>
											<TableCell>
												<Flex direction="column" gap="1" align="start">
													<Badge variant="soft" color={item.mode === 'public' ? 'green' : 'blue'}>
														{item.mode === 'public' ? '公开访问' : '授权码'}
													</Badge>
													{item.mode === 'code' && item.code && (
														<Flex align="center" gap="1" className="mt-1">
															<code className="text-[11px] bg-(--gray-3) px-1.5 py-0.5 rounded border border-(--gray-6) select-all">
																{item.code}
															</code>
															<button
																onClick={() => copyToClipboard(item.code!, `code-${item.id}`)}
																className="p-1 hover:bg-(--gray-4) rounded transition-colors"
																title="复制授权码">
																{copiedCode === `code-${item.id}` ? (
																	<CheckCircle2 size={12} className="text-green-500" />
																) : (
																	<Copy size={12} className="text-(--gray-10)" />
																)}
															</button>
														</Flex>
													)}
												</Flex>
											</TableCell>
											<TableCell>
												<Text size="2">{item.nodes?.length || 0} 个节点</Text>
											</TableCell>
											<TableCell>
												<Flex gap="1" wrap="wrap">
													{(item.tools || []).map(tool => (
														<Badge key={tool} size="1" variant="surface">
															{tool}
														</Badge>
													))}
												</Flex>
											</TableCell>
											<TableCell className="text-sm">
												{item.expires_at ? (
													<Flex align="center" gap="1">
														<Calendar size={12} className="text-(--gray-9)" />
														<span className="text-(--gray-11)">{item.expires_at}</span>
													</Flex>
												) : (
													<span className="text-(--gray-9)">永久</span>
												)}
											</TableCell>
											<TableCell className="text-sm">
												{item.max_usage ? (
													<Flex align="center" gap="1">
														<Hash size={12} className="text-(--gray-9)" />
														<span className="text-(--gray-11)">
															{item.used_count || 0} / {item.max_usage}
														</span>
													</Flex>
												) : (
													<span className="text-(--gray-9)">不限</span>
												)}
											</TableCell>
											<TableCell>
												<Flex gap="2">
													<Button size="1" variant="soft" onClick={() => openEdit(item)}>
														<Pencil size={12} />
														编辑
													</Button>
													<Button size="1" variant="outline" color="red" onClick={() => deleteAuth(item.id)}>
														<Trash2 size={12} />
														删除
													</Button>
												</Flex>
											</TableCell>
										</TableRow>
									))}
									{authList.length === 0 && (
										<TableRow>
											<TableCell colSpan={7} className="text-center py-8">
												<Text size="2" color="gray">
													{loading || isLoading ? '加载中...' : '暂无授权配置，点击右上角"新增授权"开始配置'}
												</Text>
											</TableCell>
										</TableRow>
									)}
								</TableBody>
							</Table>
						</div>
					</Tabs.Content>

					{/* 工具配置 Tab */}
					<Tabs.Content value="tools">
						<Flex direction="column" gap="3">
							<div className="flex gap-3 items-center">
								<Text size="4" weight="bold">
									工具命令模板配置
								</Text>
								<Text size="2" color="gray">
									配置各工具的命令模板和超时时间。支持变量: <code className="bg-(--gray-3) px-1 py-0.5 rounded text-xs">$INPUT</code>{' '}
									(用户输入) <b className="text-xs text-red-300">若对工具不了解，请勿修改参数</b>
								</Text>
							</div>
							<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
								{toolSettings
									.sort((a, b) => b.tool.localeCompare(a.tool))
									.map((s, idx) => (
										<Card key={s.tool} variant="surface">
											<div className="p-3 space-y-3">
												<Flex justify="start" align="center">
													<Text size="3" weight="bold">
														{s.tool}
													</Text>
												</Flex>
												<div className="flex gap-3 items-end">
													<div className="space-y-2 flex-1">
														<label className="text-xs font-medium text-(--gray-11) block">命令模板</label>
														<TextField.Root
															value={s.command_template}
															disabled={s.tool === 'iperf3'}
															onChange={e => {
																const next = [...toolSettings]
																next[idx] = {
																	...s,
																	command_template: e.target.value
																}
																setToolSettings(next)
															}}
															size="2"
														/>
													</div>
													<div className="space-y-2 w-36">
														<label className="text-xs font-medium text-(--gray-11) block">超时时间(秒)</label>
														<TextField.Root
															type="number"
															value={s.timeout_seconds}
															onChange={e => {
																const next = [...toolSettings]
																next[idx] = {
																	...s,
																	timeout_seconds: Number(e.target.value)
																}
																setToolSettings(next)
															}}
															size="2"
														/>
													</div>
												</div>
											</div>
										</Card>
									))}
							</div>
							<Flex justify="end">
								<Button onClick={saveToolSettings}>
									<Save size={16} />
									保存所有配置
								</Button>
							</Flex>
						</Flex>
					</Tabs.Content>

					{/* 安装指引 Tab */}
					<Tabs.Content value="install">
						<Flex direction="column" gap="3">
							<div className="flex gap-3 items-center">
								<Text size="4" weight="bold" className="mb-3">
									工具安装指引
								</Text>
								<Text size="2" color="gray">
									以下是各个诊断工具的推荐安装方式 (适用于 Linux 系统)
								</Text>
							</div>

							<div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
								{INSTALL_GUIDES.map(item => (
									<Card key={item.name} variant="surface">
										<div className="p-4 space-y-4">
											<Flex justify="between" align="start">
												<div className="flex-1 flex gap-3 items-center">
													<Text size="3" weight="bold" className="mb-2">
														{item.name}
													</Text>
													<Text size="1" color="gray">
														{item.desc}
													</Text>
												</div>
												{item.preinstalled && (
													<Badge variant="soft" color="green" size="1">
														预装
													</Badge>
												)}
											</Flex>
											<div className="relative group">
												<pre className="text-xs bg-(--gray-1) border border-(--gray-6) rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all">
													{item.cmd}
												</pre>
												{!item.preinstalled && (
													<button
														onClick={() => copyToClipboard(item.cmd, `install-${item.name}`)}
														className="absolute top-2 right-2 p-1.5 bg-(--gray-3) hover:bg-(--gray-4) rounded border border-(--gray-6) transition-colors opacity-0 group-hover:opacity-100"
														title="复制安装命令">
														{copiedCode === `install-${item.name}` ? (
															<CheckCircle2 size={14} className="text-green-500" />
														) : (
															<Copy size={14} className="text-(--gray-11)" />
														)}
													</button>
												)}
											</div>
										</div>
									</Card>
								))}
							</div>
						</Flex>
					</Tabs.Content>
				</Box>
			</Tabs.Root>

			{/* 新增/编辑授权对话框 */}
			<Dialog.Root open={authDialogOpen} onOpenChange={setAuthDialogOpen}>
				<Dialog.Content maxWidth="800px">
					<Dialog.Title>
						<Flex align="center" gap="2">
							<Shield size={20} />
							{editing?.id ? '编辑授权' : '新增授权'}
						</Flex>
					</Dialog.Title>
					{editing && (
						<div className="space-y-4 mt-4">
							{/* 基础信息 */}
							<div className="space-y-3">
								<Text size="3" weight="bold">
									基础信息
								</Text>
								<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
									<div className="space-y-2">
										<label className="text-xs font-medium text-(--gray-11) block">
											名称 <span className="text-red-500">*</span>
										</label>
										<TextField.Root
											placeholder="输入授权名称"
											value={editing.name}
											onChange={e => setEditing({ ...editing, name: e.target.value })}
											size="2"
											autoComplete="off"
										/>
									</div>
									<div className="space-y-2">
										<label className="text-xs font-medium text-(--gray-11) block">备注</label>
										<TextField.Root
											placeholder="输入备注信息"
											value={editing.remark}
											onChange={e => setEditing({ ...editing, remark: e.target.value })}
											size="2"
										/>
									</div>
								</div>
							</div>

							{/* 访问模式 */}
							<div className="space-y-3">
								<Text size="3" weight="bold">
									访问模式
								</Text>
								<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
									<div className="space-y-2">
										<label className="text-xs font-medium text-(--gray-11) block">
											模式 <span className="text-red-500">*</span>
										</label>
										<div className="flex flex-wrap gap-4">
											{ACCESS_MODE_OPTIONS.map(option => {
												const Icon = option.icon
												const active = editing.mode === option.value
												return (
													<label key={option.value} className="flex items-center gap-2 cursor-pointer px-1 py-1">
														<input
															type="radio"
															name="access_mode"
															checked={active}
															onChange={() => setEditing({ ...editing, mode: option.value })}
															className="w-4 h-4 accent-accent-9"
														/>
														<Icon size={16} className="text-(--gray-11)" />
														<span className={`text-sm font-medium ${active ? 'text-accent-11' : 'text-(--gray-12)'}`}>
															{option.title}
														</span>
													</label>
												)
											})}
										</div>
									</div>
									<div className="space-y-2">
										<label className="text-xs font-medium text-(--gray-11) block">
											授权码 <span className="text-(--gray-9)">(留空自动生成)</span>
										</label>
										<TextField.Root
											placeholder="留空将自动生成"
											value={editing.code}
											disabled={editing.mode === 'public'}
											onChange={e => setEditing({ ...editing, code: e.target.value })}
											size="2"
											autoComplete="off"
										/>
									</div>
								</div>
							</div>

							{/* 使用限制 */}
							<div className="space-y-3">
								<Text size="3" weight="bold">
									使用限制
								</Text>
								<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
									<div className="space-y-2">
										<label className="text-xs font-medium text-(--gray-11) block">
											到期时间 <span className="text-(--gray-9)">(留空表示永久)</span>
										</label>
										<TextField.Root
											size="2"
											type="datetime-local"
											value={editing.expires_at ? editing.expires_at.replace(' ', 'T').slice(0, 16) : ''}
											onChange={e => {
												const value = e.target.value
												setEditing({
													...editing,
													expires_at: value ? value.replace('T', ' ') + ':00' : null
												})
											}}
											className="[&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-80">
											<TextField.Slot>
												<Calendar size={14} className="text-(--gray-9)" />
											</TextField.Slot>
										</TextField.Root>
									</div>
									<div className="space-y-2">
										<label className="text-xs font-medium text-(--gray-11) block">
											次数上限 <span className="text-(--gray-9)">(留空表示不限)</span>
										</label>
										<TextField.Root
											type="number"
											placeholder="不限制"
											value={editing.max_usage ?? ''}
											onChange={e =>
												setEditing({
													...editing,
													max_usage: e.target.value ? Number(e.target.value) : null
												})
											}
											size="2"
										/>
									</div>
								</div>
							</div>

							{/* 节点和工具选择 */}
							<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
								{/* 节点选择 */}
								<NodeSelectorBox
									nodes={linuxNodes}
									selectedNodes={editing.nodes}
									onChange={nodes => setEditing({ ...editing, nodes })}
								/>

								{/* 工具选择 */}
								<ToolSelectorBox selectedTools={editing.tools} onChange={tools => setEditing({ ...editing, tools })} />
							</div>

							{/* 操作按钮 */}
							<Flex gap="3" justify="end">
								<Button variant="soft" color="gray" onClick={() => setAuthDialogOpen(false)}>
									取消
								</Button>
								<Button onClick={saveAuth}>
									<Save size={16} />
									保存授权
								</Button>
							</Flex>
						</div>
					)}
				</Dialog.Content>
			</Dialog.Root>
		</Flex>
	)
}

// 节点选择器组件
interface NodeSelectorBoxProps {
	nodes: Array<{ uuid: string; name: string; region?: string; group?: string; weight?: number }>
	selectedNodes: string[]
	onChange: (nodes: string[]) => void
}

const NodeSelectorBox: React.FC<NodeSelectorBoxProps> = ({ nodes, selectedNodes, onChange }) => {
	return (
		<div className="space-y-3 flex flex-col">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-1.5">
					<Text size="3" weight="bold">
						选择节点 <span className="text-red-500">*</span>
					</Text>
					<Text size="1" color="gray">
						仅显示 Linux 节点
					</Text>
				</div>
				<Text size="1" color="gray">
					已选择 {selectedNodes.length} 个节点
				</Text>
			</div>

			<Selector
				value={selectedNodes}
				onChange={onChange}
				items={[...nodes]}
				sortItems={compareServersByWeightName}
				getId={n => n.uuid}
				getLabel={n => (
					<Flex align="center" gap="2" className="w-full">
						<Flag flag={n.region ?? ''} size="4" />
						<span className="flex-1 truncate">{n.name}</span>
						{n.group && (
							<Badge size="1" variant="surface" color="gray">
								{n.group}
							</Badge>
						)}
					</Flex>
				)}
				filterItem={(item, keyword) => {
					const kw = keyword.toLowerCase()
					return item.name.toLowerCase().includes(kw) || item.uuid.toLowerCase().includes(kw)
				}}
				searchPlaceholder="搜索节点..."
				headerLabel="节点"
				maxHeight={280}
				groupBy={n => n.group?.trim() || ''}
				regionBy={n => n.region?.trim() || ''}
				ungroupedLabel="未分组"
				unknownRegionLabel="未知地域"
				viewModeSwitch
			/>
		</div>
	)
}

// 工具选择器组件
interface ToolSelectorBoxProps {
	selectedTools: string[]
	onChange: (tools: string[]) => void
}

const ToolSelectorBox: React.FC<ToolSelectorBoxProps> = ({ selectedTools, onChange }) => {
	const [searchText, setSearchText] = React.useState('')

	const filteredTools = React.useMemo(() => {
		if (!searchText.trim()) return TOOL_OPTIONS
		const lower = searchText.toLowerCase()
		return TOOL_OPTIONS.filter(tool => tool.toLowerCase().includes(lower))
	}, [searchText])

	const toggleTool = (tool: string) => {
		const exists = selectedTools.includes(tool)
		onChange(exists ? selectedTools.filter(t => t !== tool) : [...selectedTools, tool])
	}

	const toggleAll = () => {
		if (selectedTools.length === filteredTools.length) {
			onChange([])
		} else {
			onChange([...filteredTools])
		}
	}

	return (
		<div className="space-y-3 flex flex-col">
			{/* 标题行 - 与节点选择器对齐 */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-1.5">
					<Text size="3" weight="bold">
						可用工具
					</Text>
					<Text size="1" color="gray">
						选择可使用的诊断工具
					</Text>
				</div>
				<Text size="1" color="gray">
					已选择 {selectedTools.length} 个工具
				</Text>
			</div>

			{/* 全选按钮行 - 与 Selector 组件结构对齐，min-h-6 匹配 SegmentedControl 高度 */}
			<Flex justify="between" align="center" gap="2" className="min-h-6">
				<Flex gap="2" align="center" className="flex-1">
					<Button size="1" variant="ghost" onClick={toggleAll}>
						{selectedTools.length === filteredTools.length ? '取消全选' : '全选'}
					</Button>
				</Flex>
			</Flex>

			{/* 搜索框 */}
			<TextField.Root placeholder="搜索工具..." value={searchText} onChange={e => setSearchText(e.target.value)} size="2" />

			{/* 工具列表 */}
			<div className="h-[280px] overflow-hidden rounded-md border border-(--gray-6) bg-(--gray-2) shadow-[inset_0_1px_0_var(--gray-4)]">
				<ScrollArea type="auto" scrollbars="vertical" className="h-full">
					<div className="space-y-0 p-2">
						{filteredTools.map(tool => (
							<label key={tool} className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-(--gray-3) transition-colors cursor-pointer">
								<Checkbox checked={selectedTools.includes(tool)} onCheckedChange={() => toggleTool(tool)} />
								<span className="text-sm leading-tight">{tool}</span>
							</label>
						))}
						{filteredTools.length === 0 && <div className="text-sm text-(--gray-9) text-center py-4">暂无工具</div>}
					</div>
				</ScrollArea>
			</div>
			{/* 底部统计 - 与 Selector 组件对齐 */}
			<div className="text-gray-400 text-sm">
				已选择 {selectedTools.length} / {filteredTools.length} 项
			</div>
		</div>
	)
}

export default LgPage
