import React, { useEffect, useState } from 'react'
import { NodeDetailsProvider, useNodeDetails, type NodeDetail } from '@/contexts/NodeDetailsContext'
import { useLiveData } from '@/contexts/LiveDataContext'
import { Flex, TextField, Button, Checkbox, Text, Dialog, IconButton, TextArea, SegmentedControl, Tabs, Select } from '@radix-ui/themes'
import { Copy, Download, MenuIcon, Pencil, Plus, Settings, Terminal, Trash2Icon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { DndContext, closestCenter, useSensor, useSensors, TouchSensor, MouseSensor, KeyboardSensor } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { toast } from 'sonner'
import Flag from '@/components/Flag'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useIsMobile } from '@/hooks/use-mobile'
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer'
import { formatBytes, stringToBytes } from '@/utils/unitHelper'
import PriceTags from '@/components/PriceTags'
import Loading from '@/components/loading'
import Tips from '@/components/ui/tips'
import { SettingCardSwitch } from '@/components/admin/SettingCard'
import { useSettings } from '@/lib/api'
import { SelectOrInput } from '@/components/ui/select-or-input'
import ServerViewModeControl, { type ServerViewMode } from '@/components/server/ServerViewModeControl'
import { CredentialCreateDialog } from '@/components/admin/CredentialManagerDialog'
import { ServerSettingsPanel } from '@/components/admin/ServerSettingsPanel'
import { AddNodeDialog } from './AddNodeDialog'

const formatIpv6 = (ip: string) => {
	if (!ip) return ''
	if (ip.length <= 20) return ip
	const segments = ip.split(':')
	return segments.length > 3 ? `${segments.slice(0, 2).join(':')}:...${segments[segments.length - 1]}` : ip
}

const maskIp = (ip: string) => {
	if (!ip) return ''
	if (ip.includes('.')) {
		const parts = ip.split('.')
		if (parts.length === 4) {
			return `${parts[0]}.${parts[1]}.*.*`
		}
		return ip
	}
	if (ip.includes(':')) {
		const parts = ip.split(':')
		if (parts.length > 2) {
			return `${parts.slice(0, 2).join(':')}:****:${parts[parts.length - 1]}`
		}
	}
	return ip
}

const NodeDetailsPage = () => {
	return (
		<NodeDetailsProvider>
			<Layout />
		</NodeDetailsProvider>
	)
}

const Layout = () => {
	const { nodeDetail, isLoading, error, refresh } = useNodeDetails()
	const [searchTerm, setSearchTerm] = useState('')
	const [selectedNodes, setSelectedNodes] = useState<string[]>([])
	const [viewMode, setViewMode] = useState<ServerViewMode>('list')
	const [pageMode, setPageMode] = useState<'nodes' | 'settings'>('nodes')
	const [privacyMode, setPrivacyMode] = useState(false)
	const filteredNodes = React.useMemo(() => {
		if (!Array.isArray(nodeDetail)) return []
		return nodeDetail.filter(node => node.name.toLowerCase().includes(searchTerm.toLowerCase()))
	}, [nodeDetail, searchTerm])

	useEffect(() => {
		const interval = setInterval(() => {
			refresh()
		}, 5000)
		return () => clearInterval(interval)
	}, [refresh])

	if (isLoading) return <Loading text="" />
	if (error) return <div>{error}</div>

	return (
		<Flex direction="column" gap="4" p="4">
			{pageMode === 'nodes' ? (
				<>
					<Header
						searchTerm={searchTerm}
						setSearchTerm={setSearchTerm}
						selectedNodes={selectedNodes}
						viewMode={viewMode}
						setViewMode={setViewMode}
						privacyMode={privacyMode}
						setPrivacyMode={setPrivacyMode}
						onOpenSettings={() => setPageMode('settings')}
					/>
					<NodeTable
						nodes={filteredNodes}
						selectedNodes={selectedNodes}
						setSelectedNodes={setSelectedNodes}
						viewMode={viewMode}
						privacyMode={privacyMode}
					/>
				</>
			) : (
				<>
					<Flex justify="between" align="center" gap="4" wrap="wrap">
						<Text size="5" weight="bold">
							设置
						</Text>
						<Button variant="soft" onClick={() => setPageMode('nodes')}>
							返回节点列表
						</Button>
					</Flex>
					<ServerSettingsPanel />
				</>
			)}
		</Flex>
	)
}

const Header = ({
	searchTerm,
	setSearchTerm,
	selectedNodes,
	viewMode,
	setViewMode,
	privacyMode,
	setPrivacyMode,
	onOpenSettings
}: {
	searchTerm: string
	setSearchTerm: (term: string) => void
	selectedNodes: string[]
	viewMode: ServerViewMode
	setViewMode: (mode: ServerViewMode) => void
	privacyMode: boolean
	setPrivacyMode: (value: boolean) => void
	onOpenSettings: () => void
}) => {
	const { t } = useTranslation()
	const { refresh } = useNodeDetails()
	const [dialogOpen, setDialogOpen] = useState(false)

	return (
		<Flex justify="between" align="center" gap="4" wrap="wrap">
			<Flex gap="2" align="center">
				<Text size="5" weight="bold">
					{t('admin.nodeTable.nodeList')}
				</Text>
				{selectedNodes.length > 0 && <Text size="2">({selectedNodes.length} selected)</Text>}
			</Flex>
			<Flex gap="2" align="center">
				<ServerViewModeControl value={viewMode} onValueChange={setViewMode} size="2" />
				<Text as="label" size="2" className="flex items-center gap-2 cursor-pointer select-none">
					<Checkbox checked={privacyMode} onCheckedChange={checked => setPrivacyMode(Boolean(checked))} />
					{t('admin.nodeTable.privacyMode', '隐私模式')}
				</Text>
				<TextField.Root placeholder={t('admin.nodeTable.searchByName')} value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
				<Dialog.Root open={dialogOpen} onOpenChange={setDialogOpen}>
					<Dialog.Trigger>
						<Button>
							<Plus size={16} />
							{t('admin.nodeTable.addNode')}
						</Button>
					</Dialog.Trigger>
					<AddNodeDialog open={dialogOpen} onOpenChange={setDialogOpen} onSuccess={refresh} />
				</Dialog.Root>
				<Button variant="soft" onClick={onOpenSettings}>
					<Settings size={16} />
					设置
				</Button>
			</Flex>
		</Flex>
	)
}

const SortableRow = ({
	node,
	settings,
	privacyMode
}: {
	node: NodeDetail
	selectedNodes: string[]
	handleSelectNode: (uuid: string, checked: boolean) => void
	settings: any
	privacyMode: boolean
}) => {
	const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: node.uuid })
	const { t } = useTranslation()
	const isMobile = useIsMobile()
	const style = {
		transform: CSS.Transform.toString(transform),
		transition
	}
	function copy(text: string) {
		navigator.clipboard.writeText(text)
		toast.success(t('copy_success'))
	}
	return (
		<TableRow ref={setNodeRef} style={style} className="hover:bg-accent-a2">
			<TableCell>
				<div
					{...attributes}
					{...listeners}
					className={`cursor-move p-2 rounded hover:bg-accent-a3 transition-colors w-8 ${isMobile ? 'touch-manipulation select-none' : ''}`}
					style={{
						touchAction: 'none', // 禁用移动端的默认手势
						WebkitUserSelect: 'none',
						userSelect: 'none'
					}}
					title={isMobile ? t('admin.nodeTable.dragToReorder', '长按拖拽重新排序') : undefined}>
					<MenuIcon size={isMobile ? 18 : 16} color={'var(--gray-8)'} />
				</div>
			</TableCell>
			<TableCell className="w-40">
				<DetailView node={node} privacyMode={privacyMode} />
			</TableCell>
			<TableCell className="min-w-56">
				<Flex direction="column">
					{node.ipv4 && (
						<Text
							size="2"
							className={`flex items-center gap-1 ${privacyMode ? 'text-(--gray-10)' : 'cursor-pointer'} hover:underline`}
							title={privacyMode ? maskIp(node.ipv4) : node.ipv4}
							onClick={() => {
								if (!privacyMode) copy(node.ipv4)
							}}>
							{privacyMode ? maskIp(node.ipv4) : node.ipv4}
						</Text>
					)}
					{node.ipv6 && (
						<Text
							size="2"
							className={`flex items-center gap-1 ${privacyMode ? 'text-(--gray-10)' : 'cursor-pointer'} hover:underline`}
							title={privacyMode ? maskIp(node.ipv6) : node.ipv6}
							onClick={() => {
								if (!privacyMode) copy(node.ipv6)
							}}>
							{privacyMode ? maskIp(node.ipv6) : formatIpv6(node.ipv6)}
						</Text>
					)}
				</Flex>
			</TableCell>
			<TableCell>{node.version}</TableCell>
			<TableCell className="w-64">
				<PriceTags price={node.price} billing_cycle={node.billing_cycle} expired_at={node.expired_at} currency={node.currency} tags={node.tags || ''} />
			</TableCell>
			<TableCell>
				<ActionButtons node={node} settings={settings} />
			</TableCell>
		</TableRow>
	)
}

const NodeTable = ({
	nodes,
	selectedNodes,
	setSelectedNodes,
	viewMode,
	privacyMode
}: {
	nodes: NodeDetail[]
	selectedNodes: string[]
	setSelectedNodes: (nodes: string[]) => void
	viewMode: ServerViewMode
	privacyMode: boolean
}) => {
	const { t } = useTranslation()
	const sensors = useSensors(
		useSensor(MouseSensor, {
			// 需要按住 10px 距离才开始拖拽，避免与点击冲突
			activationConstraint: {
				distance: 10
			}
		}),
		useSensor(TouchSensor, {
			// 移动端需要按住 5px 距离才开始拖拽，并且延迟 200ms，避免与滚动冲突
			activationConstraint: {
				delay: 200,
				tolerance: 5
			}
		}),
		useSensor(KeyboardSensor, {})
	)
	// 添加 localNodes 状态，实现即时 UI 更新
	const [localNodes, setLocalNodes] = useState<NodeDetail[]>(nodes)
	const [isDragging, setIsDragging] = useState(false)
	const { settings } = useSettings()
	React.useEffect(() => {
		const sorted =
			viewMode === 'group'
				? [...nodes].sort((a, b) => {
						const ga = (a.group || '').trim()
						const gb = (b.group || '').trim()
						if (ga !== gb) {
							if (!ga) return 1
							if (!gb) return -1
							return ga.localeCompare(gb)
						}
						if (a.weight !== b.weight) return a.weight - b.weight
						return a.name.localeCompare(b.name)
				  })
				: viewMode === 'region'
				? [...nodes].sort((a, b) => {
						const ra = (a.region || '').trim()
						const rb = (b.region || '').trim()
						if (ra !== rb) {
							if (!ra) return 1
							if (!rb) return -1
							return ra.localeCompare(rb)
						}
						if (a.weight !== b.weight) return a.weight - b.weight
						return a.name.localeCompare(b.name)
				  })
				: [...nodes].sort((a, b) => {
						if (a.weight !== b.weight) return a.weight - b.weight
						return a.name.localeCompare(b.name)
				  })
		setLocalNodes(sorted)
	}, [nodes, viewMode])
	const handleDragStart = () => {
		setIsDragging(true)
		if ('vibrate' in navigator) {
			navigator.vibrate(50)
		}
	}

	const handleDragEnd = async (event: any) => {
		setIsDragging(false)
		const { active, over } = event
		if (!over || active.id === over.id) return

		const oldIndex = localNodes.findIndex(node => node.uuid === active.id)
		const newIndex = localNodes.findIndex(node => node.uuid === over.id)
		const reorderedNodes = Array.from(localNodes)
		const [reorderedItem] = reorderedNodes.splice(oldIndex, 1)
		reorderedNodes.splice(newIndex, 0, reorderedItem)

		// 立即更新 UI
		setLocalNodes(reorderedNodes)

		if ('vibrate' in navigator) {
			navigator.vibrate([30, 10, 30])
		}

		try {
			const orderData = reorderedNodes.reduce((acc, node, index) => {
				acc[node.uuid] = index
				return acc
			}, {} as Record<string, number>)

			await fetch('/api/admin/client/order', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(orderData)
			})
			// 不再调用 refresh，以免覆盖本地排序
		} catch (error) {
			toast.error('Order Failed')
		}
	}

	// 更新全选逻辑，使用 localNodes

	const handleSelectNode = (uuid: string, checked: boolean) => {
		setSelectedNodes(checked ? [...selectedNodes, uuid] : selectedNodes.filter(id => id !== uuid))
	}

	const groupedNodes = React.useMemo(() => {
		if (viewMode === 'list') return []
		const groups = new Map<string, NodeDetail[]>()
		localNodes.forEach(n => {
			const g = (viewMode === 'region' ? n.region : n.group) || ''
			const key = g.trim()
			if (!groups.has(key)) groups.set(key, [])
			groups.get(key)!.push(n)
		})
		const entries = Array.from(groups.entries()).sort((a, b) => {
			const ga = a[0]
			const gb = b[0]
			const emptyA = !ga
			const emptyB = !gb
			if (emptyA && emptyB) return 0
			if (emptyA) return 1
			if (emptyB) return -1
			return ga.localeCompare(gb)
		})
		return entries
	}, [localNodes, viewMode])
	return (
		<div className={`overflow-hidden ${isDragging ? 'select-none' : ''}`}>
			<DndContext
				sensors={sensors}
				collisionDetection={closestCenter}
				onDragStart={viewMode === 'list' ? handleDragStart : undefined}
				onDragEnd={viewMode === 'list' ? handleDragEnd : undefined}>
				<Table>
					<TableHeader style={{ backgroundColor: 'var(--accent-4)' }}>
						<TableRow>
							<TableHead className="w-8" />
							<TableHead className="w-40">{t('admin.nodeTable.name')}</TableHead>
							<TableHead className="w-56">{t('admin.nodeTable.ipAddress')}</TableHead>
							<TableHead className="w-28">{t('admin.nodeTable.clientVersion')}</TableHead>
							<TableHead className="w-64">{t('admin.nodeTable.billing')}</TableHead>
							<TableHead className="w-28" />
						</TableRow>
					</TableHeader>
					<TableBody>
						<SortableContext items={localNodes.map(node => node.uuid)} strategy={verticalListSortingStrategy} disabled={viewMode !== 'list'}>
							{viewMode !== 'list'
								? groupedNodes.flatMap(([groupName, nodes]) => {
										const items: React.ReactNode[] = []
										items.push(
											<TableRow key={`group-${groupName || 'ungrouped'}`} className="bg-accent-3">
												<TableCell colSpan={6} className="text-xs font-medium text-accent-11 uppercase tracking-wide">
													{groupName ||
														(viewMode === 'region'
															? t('common.unknown_region', { defaultValue: '未知地域' })
															: t('common.ungrouped', { defaultValue: '未分组' }))}
												</TableCell>
											</TableRow>
										)
										nodes.forEach(node => {
											items.push(
												<TableRow key={node.uuid}>
													<TableCell />
													<TableCell className="w-40">
														<DetailView node={node} privacyMode={privacyMode} />
													</TableCell>
													<TableCell className="w-56">
														{(() => {
															const ipValue = node.ipv4 || node.ipv6 || ''
															if (!ipValue) return '-'
															return privacyMode ? maskIp(ipValue) : ipValue
														})()}
													</TableCell>
													<TableCell>{node.version}</TableCell>
													<TableCell className="w-64">
														<PriceTags
															price={node.price}
															billing_cycle={node.billing_cycle}
															expired_at={node.expired_at}
															currency={node.currency}
															tags={node.tags || ''}
														/>
													</TableCell>
													<TableCell>
														<ActionButtons node={node} settings={settings} />
													</TableCell>
												</TableRow>
											)
										})
										return items
								  })
								: localNodes.map(node => (
										<SortableRow
											key={node.uuid}
											node={node}
											selectedNodes={selectedNodes}
											handleSelectNode={handleSelectNode}
											settings={settings}
											privacyMode={privacyMode}
										/>
								  ))}
						</SortableContext>
					</TableBody>
				</Table>
			</DndContext>
		</div>
	)
}

type Platform = 'linux' | 'windows' | 'macos'
type ConnectionAddressItem = { id: string; name: string; url: string; is_default: boolean }
const ActionButtons = ({ node, settings }: { node: NodeDetail; settings: any }) => {
	const { t } = useTranslation()
	return (
		<div className="flex items-center gap-4">
			<GenerateCommandButton node={node} settings={settings} />
			<IconButton
				title={t('terminal.title')}
				variant="ghost"
				onClick={() => {
					window.open(`/terminal?uuid=${node.uuid}`, '_blank')
				}}>
				<Terminal size="18" />
			</IconButton>
			<EditButton node={node} />
			<DeleteButton node={node} />
		</div>
	)
}

export default NodeDetailsPage
function DeleteButton({ node }: { node: NodeDetail }) {
	const { t } = useTranslation()
	const { refresh } = useNodeDetails()
	const [open, setOpen] = React.useState(false)
	const [deleting, setDeleting] = React.useState(false)
	const handleDelete = async () => {
		try {
			setDeleting(true)
			await fetch(`/api/admin/client/${node.uuid}/remove`, {
				method: 'POST'
			})
			toast.success(`Delete ${node.name}`)
			setOpen(false)
			refresh()
		} catch (error) {
			toast.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
		} finally {
			setDeleting(false)
		}
	}
	return (
		<Dialog.Root open={open} onOpenChange={setOpen}>
			<Dialog.Trigger>
				<IconButton variant="ghost" color="red" title={t('delete')}>
					<Trash2Icon size="18" />
				</IconButton>
			</Dialog.Trigger>
			<Dialog.Content>
				<Dialog.Title>{t('delete')}</Dialog.Title>
				<Dialog.Description>{t('admin.nodeTable.confirmDelete')}</Dialog.Description>
				<Flex justify="end" gap="2" mt="4">
					<Dialog.Trigger>
						<Button variant="soft">{t('admin.nodeTable.cancel')}</Button>
					</Dialog.Trigger>
					<Button disabled={deleting} color="red" onClick={handleDelete}>
						{t('admin.nodeTable.confirmDelete')}
					</Button>
				</Flex>
			</Dialog.Content>
		</Dialog.Root>
	)
}
type InstallOptions = {
	disableWebSsh: boolean
	disableAutoUpdate: boolean
	ignoreUnsafeCert: boolean
	memoryIncludeCache: boolean
	ghproxy: string
	dir: string
	serviceName: string
	includeNics: string
	excludeNics: string
	includeMountpoints: string
	monthRotate: string
}
function GenerateCommandButton({ node, settings }: { node: NodeDetail; settings: any }) {
	const [selectedPlatform, setSelectedPlatform] = React.useState<Platform>('linux')
	const [installOptions, setInstallOptions] = React.useState<InstallOptions>({
		disableWebSsh: false,
		disableAutoUpdate: false,
		ignoreUnsafeCert: false,
		memoryIncludeCache: false,
		ghproxy: '',
		dir: '',
		serviceName: '',
		includeNics: '',
		excludeNics: '',
		includeMountpoints: '',
		monthRotate: ''
	})
	const [endpointOptions, setEndpointOptions] = React.useState<ConnectionAddressItem[]>([])
	const [selectedEndpointId, setSelectedEndpointId] = React.useState('')
	const [endpoint, setEndpoint] = React.useState('')

	const [enableGhproxy, setEnableGhproxy] = React.useState(false)
	const [enableCustomDir, setEnableCustomDir] = React.useState(false)
	const [enableCustomServiceName, setEnableCustomServiceName] = React.useState(false)
	const [enableIncludeNics, setEnableIncludeNics] = React.useState(false)
	const [enableExcludeNics, setEnableExcludeNics] = React.useState(false)
	const [enableIncludeMountpoints, setEnableIncludeMountpoints] = React.useState(false)
	const [enableMonthRotate, setEnableMonthRotate] = React.useState(false)

	React.useEffect(() => {
		const raw = settings?.connection_addresses
		let list: any[] = []
		if (typeof raw === 'string' && raw.trim()) {
			try {
				list = JSON.parse(raw)
			} catch {
				list = []
			}
		}
		const normalized: ConnectionAddressItem[] = Array.isArray(list)
			? list
					.map((it: any) => ({
						id: String(it?.id || ''),
						name: String(it?.name || ''),
						url: String(it?.url || ''),
						is_default: Boolean(it?.is_default)
					}))
					.filter((it: any) => it.id && it.url)
			: []
		setEndpointOptions(normalized)
		const def = normalized.find(it => it.is_default) || normalized[0]
		if (def?.url) {
			setEndpoint(String(def.url).replace(/\/+$/, ''))
			setSelectedEndpointId(def.id)
		} else {
			setEndpoint('')
			setSelectedEndpointId('')
		}
	}, [settings])

	const generateCommand = () => {
		const fallbackHost = (function () {
			if (!settings.script_domain) {
				return window.location.origin
			}
			if (settings.script_domain.startsWith('http')) {
				return settings.script_domain.replace(/\/+$/, '')
			}
			return `http://${settings.script_domain.replace(/\/+$/, '')}`
		})()
		const host = (endpoint || fallbackHost).replace(/\/+$/, '')
		const token = node.token || ''
		let args = ['-e', host, '-t', token]
		// 根据安装选项生成参数
		if (installOptions.disableWebSsh) {
			args.push('--disable-web-ssh')
		}
		if (installOptions.disableAutoUpdate) {
			args.push('--disable-auto-update')
		}
		if (installOptions.ignoreUnsafeCert) {
			args.push('--ignore-unsafe-cert')
		}
		if (installOptions.memoryIncludeCache) {
			args.push('--memory-include-cache')
		}
		if (enableGhproxy && installOptions.ghproxy) {
			const finalUrl = (installOptions.ghproxy.startsWith('http') ? installOptions.ghproxy : `http://${installOptions.ghproxy}`).replace(/\/+$/, '')
			args.push(`--install-ghproxy`)
			args.push(finalUrl)
		}
		if (enableCustomDir && installOptions.dir) {
			args.push(`--install-dir`)
			args.push(installOptions.dir)
		}
		if (enableCustomServiceName && installOptions.serviceName) {
			args.push(`--install-service-name`)
			args.push(installOptions.serviceName)
		}
		if (enableIncludeNics && installOptions.includeNics) {
			args.push(`--include-nics`)
			args.push(installOptions.includeNics)
		}
		if (enableExcludeNics && installOptions.excludeNics) {
			args.push(`--exclude-nics`)
			args.push(installOptions.excludeNics)
		}
		if (enableIncludeMountpoints && installOptions.includeMountpoints) {
			args.push(`--include-mountpoint`)
			args.push(installOptions.includeMountpoints)
		}
		if (enableMonthRotate) {
			const rotateVal = (installOptions.monthRotate || '').trim() || '1' // 默认 1
			args.push(`--month-rotate`)
			args.push(rotateVal)
		}
		let scriptFile = 'install.sh'
		if (selectedPlatform === 'windows') {
			scriptFile = 'install.ps1'
		}
		let scriptUrl = `${host}/api/public/${scriptFile}`
		let finalCommand = ''
		switch (selectedPlatform) {
			case 'linux':
				finalCommand = `bash <(curl -sL ${scriptUrl}) ` + args.join(' ')
				break
			case 'windows':
				finalCommand =
					`powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ` +
					`"iwr '${scriptUrl}'` +
					` -UseBasicParsing -OutFile 'install.ps1'; &` +
					` '.\\install.ps1'`
				args.forEach(arg => {
					finalCommand += ` '${arg}'`
				})
				finalCommand += `"`
				break
			case 'macos':
				finalCommand = `zsh <(curl -sL ${scriptUrl}) ` + args.join(' ')
				break
		}
		return finalCommand
	}

	const { t } = useTranslation()
	const copyToClipboard = async (text: string) => {
		try {
			await navigator.clipboard.writeText(text)
			toast.success(t('copy_success', '已复制到剪贴板'))
		} catch (err) {
			console.error('Failed to copy text: ', err)
		}
	}
	return (
		<Dialog.Root>
			<Dialog.Trigger>
				<IconButton variant="ghost" title={t('admin.nodeTable.installCommand')}>
					<Download size="18" />
				</IconButton>
			</Dialog.Trigger>
			<Dialog.Content>
				<Dialog.Title>{t('admin.nodeTable.installCommand', '一键部署指令')}</Dialog.Title>
				<div className="flex flex-col gap-4">
					<SegmentedControl.Root value={selectedPlatform} onValueChange={value => setSelectedPlatform(value as Platform)}>
						<SegmentedControl.Item value="linux">Linux</SegmentedControl.Item>
						<SegmentedControl.Item value="windows">Windows</SegmentedControl.Item>
						<SegmentedControl.Item value="macos">macOS</SegmentedControl.Item>
					</SegmentedControl.Root>

					<Flex direction="column" gap="2">
						<label className="text-base font-bold">{t('admin.nodeTable.deployEndpoint', '连接地址')}</label>
						{endpointOptions.length > 0 ? (
							<Select.Root
								value={selectedEndpointId}
								onValueChange={value => {
									setSelectedEndpointId(value)
									const selected = endpointOptions.find(it => it.id === value)
									setEndpoint(selected ? String(selected.url).replace(/\/+$/, '') : '')
								}}>
								<Select.Trigger placeholder={t('admin.nodeTable.selectDeployEndpoint', '选择连接地址')} />
								<Select.Content>
									{endpointOptions.map(it => (
										<Select.Item key={it.id} value={it.id}>
											{it.name ? `${it.name} (${it.url})` : it.url}
										</Select.Item>
									))}
								</Select.Content>
							</Select.Root>
						) : (
							<Text size="2" color="gray">
								{t('admin.nodeTable.connectionAddressFallback', '未配置连接地址，将使用当前访问域名')}
							</Text>
						)}
					</Flex>

					<Flex direction="column" gap="2">
						<label className="text-base font-bold">{t('admin.nodeTable.installOptions', '安装选项')}</label>
						<div className="grid grid-cols-2 gap-2">
							<Flex gap="2" align="center">
								<Checkbox
									checked={installOptions.disableWebSsh}
									onCheckedChange={checked => {
										setInstallOptions(prev => ({
											...prev,
											disableWebSsh: Boolean(checked)
										}))
									}}
								/>
								<label
									className="text-sm font-normal"
									onClick={() => {
										setInstallOptions(prev => ({
											...prev,
											disableWebSsh: !prev.disableWebSsh
										}))
									}}>
									{t('admin.nodeTable.disableWebSsh')}
								</label>
							</Flex>
							<Flex gap="2" align="center">
								<Checkbox
									checked={installOptions.disableAutoUpdate}
									onCheckedChange={checked => {
										setInstallOptions(prev => ({
											...prev,
											disableAutoUpdate: Boolean(checked)
										}))
									}}></Checkbox>
								<label
									className="text-sm font-normal"
									onClick={() => {
										setInstallOptions(prev => ({
											...prev,
											disableAutoUpdate: !prev.disableAutoUpdate
										}))
									}}>
									{t('admin.nodeTable.disableAutoUpdate', '禁用自动更新')}
								</label>
							</Flex>
							<Flex gap="2" align="center">
								<Checkbox
									checked={installOptions.ignoreUnsafeCert}
									onCheckedChange={checked => {
										setInstallOptions(prev => ({
											...prev,
											ignoreUnsafeCert: Boolean(checked)
										}))
									}}
								/>
								<label
									className="text-sm font-normal"
									onClick={() => {
										setInstallOptions(prev => ({
											...prev,
											ignoreUnsafeCert: !prev.ignoreUnsafeCert
										}))
									}}>
									{t('admin.nodeTable.ignoreUnsafeCert', '忽略不安全证书')}
								</label>
							</Flex>
							<Flex gap="2" align="center">
								<Checkbox
									checked={installOptions.memoryIncludeCache}
									onCheckedChange={checked => {
										setInstallOptions(prev => ({
											...prev,
											memoryIncludeCache: Boolean(checked)
										}))
									}}
								/>
								<label
									className="text-sm font-normal"
									onClick={() => {
										setInstallOptions(prev => ({
											...prev,
											memoryIncludeCache: !prev.memoryIncludeCache
										}))
									}}>
									{t('admin.nodeTable.memoryModeAvailable', '监测可用内存')}
								</label>
								<Tips size="14">{t('admin.nodeTable.memoryModeAvailable_tip')}</Tips>
							</Flex>
						</div>
						<Flex direction="column" gap="2">
							<Flex gap="2" align="center">
								<Checkbox
									checked={enableGhproxy}
									onCheckedChange={checked => {
										setEnableGhproxy(Boolean(checked))
										if (!checked) {
											setInstallOptions(prev => ({
												...prev,
												ghproxy: ''
											}))
										}
									}}
								/>
								<label
									className="text-sm font-bold cursor-pointer"
									onClick={() => {
										setEnableGhproxy(!enableGhproxy)
										if (enableGhproxy) {
											setInstallOptions(prev => ({
												...prev,
												ghproxy: ''
											}))
										}
									}}>
									{t('admin.nodeTable.ghproxy', 'GitHub 代理')}
								</label>
							</Flex>
							{enableGhproxy && (
								<TextField.Root
									placeholder="https://proxy.qwdd.de/"
									value={installOptions.ghproxy}
									onChange={e =>
										setInstallOptions(prev => ({
											...prev,
											ghproxy: e.target.value
										}))
									}
								/>
							)}

							<Flex gap="2" align="center">
								<Checkbox
									checked={enableCustomDir}
									onCheckedChange={checked => {
										setEnableCustomDir(Boolean(checked))
										if (!checked) {
											setInstallOptions(prev => ({
												...prev,
												dir: ''
											}))
										}
									}}
								/>
								<label
									className="text-sm font-bold cursor-pointer"
									onClick={() => {
										setEnableCustomDir(!enableCustomDir)
										if (enableCustomDir) {
											setInstallOptions(prev => ({
												...prev,
												dir: ''
											}))
										}
									}}>
									{t('admin.nodeTable.install_dir', '安装目录')}
								</label>
							</Flex>
							{enableCustomDir && (
								<TextField.Root
									placeholder={t('admin.nodeTable.install_dir_placeholder', '安装目录，为空则使用默认目录(/opt/komari-agent)')}
									value={installOptions.dir}
									onChange={e =>
										setInstallOptions(prev => ({
											...prev,
											dir: e.target.value
										}))
									}
								/>
							)}

							<Flex gap="2" align="center">
								<Checkbox
									checked={enableCustomServiceName}
									onCheckedChange={checked => {
										setEnableCustomServiceName(Boolean(checked))
										if (!checked) {
											setInstallOptions(prev => ({
												...prev,
												serviceName: ''
											}))
										}
									}}
								/>
								<label
									className="text-sm font-bold cursor-pointer"
									onClick={() => {
										setEnableCustomServiceName(!enableCustomServiceName)
										if (enableCustomServiceName) {
											setInstallOptions(prev => ({
												...prev,
												serviceName: ''
											}))
										}
									}}>
									{t('admin.nodeTable.serviceName', '服务名称')}
								</label>
							</Flex>
							{enableCustomServiceName && (
								<TextField.Root
									placeholder={t('admin.nodeTable.serviceName_placeholder', '服务名称，为空则使用默认名称(komari-agent)')}
									value={installOptions.serviceName}
									onChange={e =>
										setInstallOptions(prev => ({
											...prev,
											serviceName: e.target.value
										}))
									}
								/>
							)}
							<Flex gap="2" align="center">
								<Checkbox
									checked={enableIncludeNics}
									onCheckedChange={checked => {
										setEnableIncludeNics(Boolean(checked))
										if (!checked) {
											setInstallOptions(prev => ({
												...prev,
												includeNics: ''
											}))
										}
									}}
								/>
								<label
									className="text-sm font-bold cursor-pointer"
									onClick={() => {
										setEnableIncludeNics(!enableIncludeNics)
										if (enableIncludeNics) {
											setInstallOptions(prev => ({
												...prev,
												includeNics: ''
											}))
										}
									}}>
									{t('admin.nodeTable.includeNics', '只监测特定网卡')}
								</label>
							</Flex>
							{enableIncludeNics && (
								<TextField.Root
									placeholder="eth0,eth1"
									value={installOptions.includeNics}
									onChange={e =>
										setInstallOptions(prev => ({
											...prev,
											includeNics: e.target.value
										}))
									}
								/>
							)}
							<Flex gap="2" align="center">
								<Checkbox
									checked={enableExcludeNics}
									onCheckedChange={checked => {
										setEnableExcludeNics(Boolean(checked))
										if (!checked) {
											setInstallOptions(prev => ({
												...prev,
												excludeNics: ''
											}))
										}
									}}
								/>
								<label
									className="text-sm font-bold cursor-pointer"
									onClick={() => {
										setEnableExcludeNics(!enableExcludeNics)
										if (enableExcludeNics) {
											setInstallOptions(prev => ({
												...prev,
												excludeNics: ''
											}))
										}
									}}>
									{t('admin.nodeTable.excludeNics', '排除特定网卡')}
								</label>
							</Flex>
							{enableExcludeNics && (
								<TextField.Root
									placeholder="lo"
									value={installOptions.excludeNics}
									onChange={e =>
										setInstallOptions(prev => ({
											...prev,
											excludeNics: e.target.value
										}))
									}
								/>
							)}
							<Flex gap="2" align="center">
								<Checkbox
									checked={enableIncludeMountpoints}
									onCheckedChange={checked => {
										setEnableIncludeMountpoints(Boolean(checked))
										if (!checked) {
											setInstallOptions(prev => ({
												...prev,
												includeMountpoints: ''
											}))
										}
									}}
								/>
								<label
									className="text-sm font-bold cursor-pointer"
									onClick={() => {
										setEnableIncludeMountpoints(!enableIncludeMountpoints)
										if (enableIncludeMountpoints) {
											setInstallOptions(prev => ({
												...prev,
												includeMountpoints: ''
											}))
										}
									}}>
									{t('admin.nodeTable.includeMountpoints', '只监测特定挂载点')}
								</label>
							</Flex>
							{enableIncludeMountpoints && (
								<TextField.Root
									placeholder="/;/home;/var"
									value={installOptions.includeMountpoints}
									onChange={e =>
										setInstallOptions(prev => ({
											...prev,
											includeMountpoints: e.target.value
										}))
									}
								/>
							)}
							<Flex gap="2" align="center">
								<Checkbox
									checked={enableMonthRotate}
									onCheckedChange={checked => {
										const enabled = Boolean(checked)
										setEnableMonthRotate(enabled)
										if (!enabled) {
											setInstallOptions(prev => ({
												...prev,
												monthRotate: ''
											}))
										} else {
											setInstallOptions(prev => ({
												...prev,
												monthRotate: prev.monthRotate?.trim() ? prev.monthRotate : '1'
											}))
										}
									}}
								/>
								<label
									className="text-sm font-bold cursor-pointer"
									onClick={() => {
										const willEnable = !enableMonthRotate
										setEnableMonthRotate(willEnable)
										if (!willEnable) {
											setInstallOptions(prev => ({
												...prev,
												monthRotate: ''
											}))
										} else {
											setInstallOptions(prev => ({
												...prev,
												monthRotate: prev.monthRotate?.trim() ? prev.monthRotate : '1'
											}))
										}
									}}>
									{t('admin.nodeTable.monthRotate', '网络统计月重置')}
								</label>
							</Flex>
							{enableMonthRotate && (
								<TextField.Root
									placeholder="1"
									type="number"
									min="1"
									max="31"
									value={installOptions.monthRotate}
									onChange={e =>
										setInstallOptions(prev => ({
											...prev,
											monthRotate: e.target.value
										}))
									}
								/>
							)}
						</Flex>
					</Flex>
					<Flex direction="column" gap="2">
						<label className="text-base font-bold">{t('admin.nodeTable.generatedCommand', '生成的指令')}</label>
						<div className="relative">
							<TextArea disabled className="w-full" style={{ minHeight: '80px' }} value={generateCommand()} />
						</div>
					</Flex>
					<Flex justify="center">
						<Button style={{ width: '100%' }} onClick={() => copyToClipboard(generateCommand())}>
							<Copy size={16} />
							{t('copy')}
						</Button>
					</Flex>
				</div>
			</Dialog.Content>
		</Dialog.Root>
	)
}

function EditButton({ node }: { node: NodeDetail }) {
	const { t } = useTranslation()
	const { refresh, nodeDetail } = useNodeDetails()
	const [open, setOpen] = useState(false)
	const [saving, setSaving] = useState(false)
	const [tab, setTab] = useState<'basic' | 'billing' | 'ssh'>('basic')
	const canUseSsh = !node.os || node.os === 'linux' || node.os === 'darwin'
	const [credentialItems, setCredentialItems] = useState<Array<{ id: number; name: string; username: string; type: string }>>([])
	const [credentialLoading, setCredentialLoading] = useState(false)

	const fetchCredentials = React.useCallback(async () => {
		setCredentialLoading(true)
		try {
			const resp = await fetch('/api/admin/credential')
			if (!resp.ok) throw new Error(resp.statusText)
			const data = await resp.json()
			setCredentialItems(data?.data ?? [])
		} catch (e) {
			console.error('Failed to fetch credentials', e)
		} finally {
			setCredentialLoading(false)
		}
	}, [])

	const groupOptions = React.useMemo(() => {
		const set = new Set<string>()
		nodeDetail.forEach(n => n.group && set.add(n.group))
		return Array.from(set).map(g => ({ label: g, value: g }))
	}, [nodeDetail])

	const currencyPresets = React.useMemo(
		() => [
			{ code: '¥', label: t('currency.cny', '人民币') },
			{ code: '$', label: t('currency.usd', '美元') },
			{ code: '€', label: t('currency.eur', '欧元') },
			{ code: '£', label: t('currency.gbp', '英镑') },
			{ code: '₽', label: t('currency.rub', '卢布') },
			{ code: '₣', label: t('currency.chf', '法郎') },
			{ code: '₹', label: t('currency.inr', '卢比') },
			{ code: '₫', label: t('currency.vnd', '越南盾') },
			{ code: '฿', label: t('currency.thb', '泰铢') }
		],
		[t]
	)
	const billingPresets = React.useMemo(
		() => [
			{ label: t('common.monthly'), value: '30' },
			{ label: t('common.quarterly'), value: '92' },
			{ label: t('common.semi_annual'), value: '184' },
			{ label: t('common.annual'), value: '365' },
			{ label: t('common.biennial'), value: '730' },
			{ label: t('common.triennial'), value: '1095' },
			{ label: t('common.quinquennial'), value: '1825' },
			{ label: t('common.once'), value: '-1' }
		],
		[t]
	)

	const initialForm = React.useMemo(
		() => ({
			startedAt: (() => {
				const candidate = (node as any).started_at as string | undefined
				if (!candidate) return ''
				const date = new Date(candidate)
				return isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)
			})(),
			name: node.name,
			tags: node.tags || '',
			group: node.group || '',
			remark: node.remark || '',
			publicRemark: node.public_remark || '',
			hidden: node.hidden,
			trafficType: node.traffic_limit_type || 'sum',
			trafficLimit: node.traffic_limit || 0,
			trafficInput: formatBytes(node.traffic_limit || 0),
			price: node.price || 0,
			currencyMode: currencyPresets.find(c => c.code === node.currency)?.code || 'custom',
			customCurrency: currencyPresets.find(c => c.code === node.currency) ? '' : node.currency || '',
			billingMode: billingPresets.find(b => b.value === (node.billing_cycle || 30).toString())?.value || 'custom',
			customBilling: billingPresets.find(b => b.value === (node.billing_cycle || 30).toString()) ? '' : (node.billing_cycle || 30).toString(),
			expiredAt: node.expired_at ? new Date(node.expired_at).toISOString().slice(0, 10) : '0001-01-01',
			autoRenewal: node.auto_renewal || false,
			sshEnabled: Boolean((node as any).ssh_enabled),
			sshHost: ((node as any).ssh_host as string) || '',
			sshPort: (node as any).ssh_port || 22,
			sshCredentialId: (node as any).ssh_credential_id || 0
		}),
		[node, currencyPresets, billingPresets]
	)

	const [form, setForm] = useState(initialForm)

	const quickExpireButtons = [
		{ label: '+1月', months: 1 },
		{ label: '+3月', months: 3 },
		{ label: '+6月', months: 6 },
		{ label: '+1年', months: 12 }
	]

	const adjustExpired = (months: number) => {
		const base = form.expiredAt && form.expiredAt !== '0001-01-01' ? new Date(form.expiredAt) : new Date()
		if (isNaN(base.getTime())) return
		base.setMonth(base.getMonth() + months)
		setForm(f => ({ ...f, expiredAt: base.toISOString().slice(0, 10) }))
	}

	const handleSave = async () => {
		try {
			setSaving(true)
			const billing_cycle = form.billingMode === 'custom' ? parseInt(form.customBilling || '30') : parseInt(form.billingMode)
			const currency = form.currencyMode === 'custom' ? form.customCurrency || '$' : form.currencyMode
			await fetch(`/api/admin/client/${node.uuid}/edit`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					started_at: form.startedAt ? form.startedAt : null,
					name: form.name,
					remark: form.remark,
					public_remark: form.publicRemark,
					group: form.group,
					tags: form.tags,
					hidden: form.hidden,
					traffic_limit: form.trafficLimit,
					traffic_limit_type: form.trafficType,
					price: form.price,
					currency,
					billing_cycle,
					expired_at: form.expiredAt,
					auto_renewal: form.autoRenewal,
					ssh_enabled: canUseSsh ? form.sshEnabled : false,
					ssh_host: canUseSsh && form.sshEnabled ? form.sshHost : '',
					ssh_port: canUseSsh && form.sshEnabled ? Number(form.sshPort || 22) : 22,
					ssh_credential_id: canUseSsh && form.sshEnabled ? Number(form.sshCredentialId || 0) : 0
				})
			})
			toast.success(t('admin.nodeEdit.saveSuccess', '保存成功'))
			refresh()
			setOpen(false)
		} catch (error) {
			toast.error(`${t('common.error', 'Error')}: ${error instanceof Error ? error.message : String(error)}`)
		} finally {
			setSaving(false)
		}
	}

	const handleOpenChange = (next: boolean) => {
		setOpen(next)
		if (next) {
			React.startTransition(() => {
				setForm(initialForm)
				setTab('basic')
			})
		} else {
			// 释放引用，避免泄露
			setCredentialItems([])
		}
	}

	return (
		<Dialog.Root open={open} onOpenChange={handleOpenChange}>
			<Dialog.Trigger>
				<IconButton variant="ghost" title={t('admin.nodeEdit.editInfo', '编辑信息')}>
					<Pencil size="18" />
				</IconButton>
			</Dialog.Trigger>
			<Dialog.Content>
				<Dialog.Title>{t('admin.nodeEdit.editInfo', '编辑信息')}</Dialog.Title>
				<Tabs.Root value={tab} onValueChange={v => setTab(v as any)}>
					<Tabs.List>
						<Tabs.Trigger value="basic">{t('admin.nodeEdit.basic', '基础信息')}</Tabs.Trigger>
						<Tabs.Trigger value="billing">{t('admin.nodeTable.billing', '账单配置')}</Tabs.Trigger>
						{canUseSsh && <Tabs.Trigger value="ssh">{t('admin.nodeEdit.sshTab', 'SSH')}</Tabs.Trigger>}
					</Tabs.List>
					<Tabs.Content value="basic">
						<div className="flex flex-col gap-4 pt-3">
							<div>
								<label className="block mb-1 text-sm font-medium text-muted-foreground">{t('admin.nodeEdit.name', '名称')}</label>
								<TextField.Root
									value={form.name}
									onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
									placeholder={t('admin.nodeEdit.namePlaceholder', '请输入名称')}
								/>
							</div>
							<div className='hidden'>
								<label className="block mb-1 text-sm font-medium text-muted-foreground">{t('admin.nodeEdit.token', 'Token 令牌')}</label>
								<TextField.Root value={node.token} readOnly />
							</div>
							<div>
								<label className="mb-1 text-sm font-medium text-muted-foreground flex items-center">
									{t('common.tags')}
									<label className="text-muted-foreground ml-1 text-xs self-end">{t('common.tagsDescription')}</label>
									<Tips className='ml-2'>
										<span dangerouslySetInnerHTML={{ __html: t('common.tagsTips') }} />
									</Tips>
								</label>
								<TextField.Root value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))} />
							</div>
							<div>
								<label className="block mb-1 text-sm font-medium text-muted-foreground">{t('common.group')}</label>
								<SelectOrInput
									options={groupOptions}
									placeholder={t('common.group')}
									value={form.group}
									onChange={v => setForm(f => ({ ...f, group: v }))}
								/>
							</div>
							<div>
								<label className="block mb-1 text-sm font-medium text-muted-foreground">{t('admin.nodeEdit.remark', '私有备注')}</label>
								<TextArea value={form.remark} onChange={e => setForm(f => ({ ...f, remark: e.target.value }))} resize={'vertical'} />
							</div>
							<div>
								<SettingCardSwitch
									title={t('admin.nodeEdit.hidden')}
									description={t('admin.nodeEdit.hidden_description')}
									defaultChecked={form.hidden}
									onChange={val => setForm(f => ({ ...f, hidden: val ?? false }))}
								/>
							</div>
							<div className="rounded-md border border-accent-5 bg-accent-2 p-3">
								<label className="block mb-2 text-sm font-medium text-muted-foreground">{t('admin.nodeEdit.trafficLimit')}</label>
								<Flex gap="3" align="center" wrap="wrap">
									<Select.Root value={form.trafficType} onValueChange={v => setForm(f => ({ ...f, trafficType: v }))}>
										<Select.Trigger />
										<Select.Content>
											<Select.Item value="sum">{t('admin.nodeEdit.trafficLimitType_sum')}</Select.Item>
											<Select.Item value="max">{t('admin.nodeEdit.trafficLimitType_max')}</Select.Item>
											<Select.Item value="min">{t('admin.nodeEdit.trafficLimitType_min')}</Select.Item>
											<Select.Item value="up">{t('admin.nodeEdit.trafficLimitType_up')}</Select.Item>
											<Select.Item value="down">{t('admin.nodeEdit.trafficLimitType_down')}</Select.Item>
										</Select.Content>
									</Select.Root>
									<TextField.Root
										value={form.trafficInput}
										onChange={e => setForm(f => ({ ...f, trafficInput: e.target.value }))}
										onBlur={e => {
											const bytes = stringToBytes(e.target.value)
											setForm(f => ({
												...f,
												trafficLimit: bytes,
												trafficInput: formatBytes(bytes)
											}))
										}}
										placeholder={t('admin.nodeEdit.trafficLimit_description', '输入流量阈值')}
									/>
								</Flex>
							</div>
						</div>
					</Tabs.Content>
					<Tabs.Content value="billing">
						<div className="flex flex-col gap-4 pt-3">
							<div>
								<label className="font-bold">{t('admin.nodeTable.price')}</label>
								<TextField.Root
									name="price"
									type="number"
									value={form.price}
									onChange={e =>
										setForm(f => ({
											...f,
											price: parseFloat(e.target.value || '0')
										}))
									}
								/>
							</div>
							<div>
								<label className="font-bold">{t('admin.nodeTable.currency', '货币')}</label>
								<Flex gap="2" wrap="wrap">
									{currencyPresets.map(c => {
										const active = form.currencyMode === c.code
										return (
											<Button
												key={c.code}
												variant={active ? 'solid' : 'soft'}
												color={active ? 'blue' : undefined}
												onClick={() =>
													setForm(f => ({
														...f,
														currencyMode: c.code,
														customCurrency: ''
													}))
												}>
												{c.label}
											</Button>
										)
									})}
									<Flex align="center" gap="2">
										<Button
											variant={form.currencyMode === 'custom' ? 'solid' : 'soft'}
											color={form.currencyMode === 'custom' ? 'blue' : undefined}
											onClick={() =>
												setForm(f => ({
													...f,
													currencyMode: 'custom',
													customCurrency: f.customCurrency || '$'
												}))
											}>
											{t('common.custom', { defaultValue: '自定义' })}
										</Button>
										<TextField.Root
											value={form.customCurrency}
											onChange={e =>
												setForm(f => ({
													...f,
													currencyMode: 'custom',
													customCurrency: e.target.value
												}))
											}
											placeholder="$"
											className="min-w-30"
											size="2"
										/>
									</Flex>
								</Flex>
							</div>
							<div>
								<label className="font-bold flex items-center gap-1">
									{t('admin.nodeTable.billingCycle')}{' '}
									<Tips>
										<span
											dangerouslySetInnerHTML={{
												__html: t('admin.nodeTable.billingCycleTips')
											}}></span>
									</Tips>
								</label>
								<div className="flex flex-col gap-2">
									<Flex gap="2" wrap="wrap">
										{billingPresets.map(o => {
											const active = form.billingMode === o.value
											return (
												<Button
													key={o.value}
													variant={active ? 'solid' : 'soft'}
													color={active ? 'blue' : undefined}
													onClick={() =>
														setForm(f => ({
															...f,
															billingMode: o.value,
															customBilling: ''
														}))
													}>
													{o.label}
												</Button>
											)
										})}
									</Flex>
									<Flex gap="2" align="center">
										<Button
											variant={form.billingMode === 'custom' ? 'solid' : 'soft'}
											color={form.billingMode === 'custom' ? 'blue' : undefined}
											onClick={() =>
												setForm(f => ({
													...f,
													billingMode: 'custom',
													customBilling: f.customBilling || '30'
												}))
											}>
											{t('common.custom', { defaultValue: '自定义' })}
										</Button>
										<TextField.Root
											type="number"
											min="1"
											value={form.customBilling}
											onChange={e =>
												setForm(f => ({
													...f,
													billingMode: 'custom',
													customBilling: e.target.value
												}))
											}
											placeholder="30"
											size="2">
											<TextField.Slot side="right">{t('common.day', { defaultValue: '天' })}</TextField.Slot>
										</TextField.Root>
									</Flex>
								</div>
							</div>
							<div>
								<Flex gap="4" wrap="wrap">
									<div className="flex-1 min-w-64">
										<label className="font-bold">{t('admin.nodeTable.startedAt', '开始时间')}</label>
										<TextField.Root
											name="startedAt"
											type="date"
											value={form.startedAt}
											onChange={e => setForm(f => ({ ...f, startedAt: e.target.value }))}>
											<TextField.Slot side="right">
												<Button type="button" variant="ghost" onClick={() => setForm(f => ({ ...f, startedAt: '' }))}>
													{t('admin.nodeTable.clearDate', '清除')}
												</Button>
											</TextField.Slot>
										</TextField.Root>
									</div>
									<div className="flex-1 min-w-64">
										<label className="font-bold">{t('admin.nodeTable.expiredAt')}</label>
										<TextField.Root
											name="expiredAt"
											type="date"
											value={form.expiredAt}
											onChange={e => setForm(f => ({ ...f, expiredAt: e.target.value }))}>
											<TextField.Slot side="right">
												<Button
													type="button"
													variant="ghost"
													onClick={() => {
														const futureDate = new Date()
														futureDate.setFullYear(futureDate.getFullYear() + 200)
														setForm(f => ({
															...f,
															expiredAt: futureDate.toISOString().slice(0, 10)
														}))
													}}>
													{t('admin.nodeTable.setToLongTerm', '设置为长期')}
												</Button>
											</TextField.Slot>
										</TextField.Root>
										<Flex gap="2" wrap="wrap" className="mt-2">
											{quickExpireButtons.map(btn => (
												<Button key={btn.label} size="1" variant="soft" type="button" onClick={() => adjustExpired(btn.months)}>
													{btn.label}
												</Button>
											))}
										</Flex>
									</div>
								</Flex>
							</div>
							<SettingCardSwitch
								title={t('admin.nodeTable.autoRenewal')}
								description={t('admin.nodeTable.autoRenewalDescription')}
								defaultChecked={form.autoRenewal}
								onChange={v => setForm(f => ({ ...f, autoRenewal: v ?? false }))}
							/>
						</div>
					</Tabs.Content>
					{canUseSsh && (
						<Tabs.Content value="ssh">
							<div className="flex flex-col gap-3 pt-3">
								<Flex justify="between" align="center">
									<Text size="3" weight="bold">
										{t('admin.nodeEdit.sshConfig', 'SSH 配置（Linux/macOS，仅 root）')}
									</Text>
									<CredentialCreateDialog onSaved={fetchCredentials} />
								</Flex>
								<Text as="label" size="2" className="flex items-center gap-2 cursor-pointer select-none">
									<Checkbox checked={!!form.sshEnabled} onCheckedChange={v => setForm(f => ({ ...f, sshEnabled: Boolean(v) }))} />
									{t('admin.nodeEdit.enableSsh', '启用 SSH 配置')}
								</Text>
								{form.sshEnabled && (
									<div className="flex flex-col gap-2 rounded-md border border-gray-a6 p-3">
										<label className="block mb-1 text-sm font-medium text-muted-foreground">{t('admin.nodeEdit.sshHost', '地址')}</label>
										<TextField.Root value={form.sshHost} onChange={e => setForm(f => ({ ...f, sshHost: e.target.value }))} />
										<label className="block mb-1 text-sm font-medium text-muted-foreground">{t('admin.nodeEdit.sshPort', '端口')}</label>
										<TextField.Root
											type="number"
											value={String(form.sshPort)}
											onChange={e => setForm(f => ({ ...f, sshPort: Number(e.target.value || 22) }))}
										/>
										<label className="block mb-1 text-sm font-medium text-muted-foreground">{t('admin.nodeEdit.credential', '凭据')}</label>
										<Select.Root
											value={form.sshCredentialId ? String(form.sshCredentialId) : '__placeholder__'}
											onValueChange={v => setForm(f => ({ ...f, sshCredentialId: v && v !== '__placeholder__' ? Number(v) : 0 }))}>
											<Select.Trigger onClick={() => fetchCredentials()} />
											<Select.Content>
												<Select.Item value="__placeholder__" disabled>
													{credentialLoading ? t('loading', '加载中...') : t('admin.nodeEdit.selectCredential', '选择凭据')}
												</Select.Item>
												{credentialItems.map(it => (
													<Select.Item key={it.id} value={String(it.id)}>
														{it.name} ({it.username}/{it.type})
													</Select.Item>
												))}
											</Select.Content>
										</Select.Root>
									</div>
								)}
							</div>
						</Tabs.Content>
					)}
				</Tabs.Root>
				<Flex gap="2" justify={'end'} className="mt-4">
					<Button type="submit" className="w-full" disabled={saving} onClick={handleSave}>
						{saving ? t('admin.nodeEdit.waiting', '等待...') : t('save', '保存')}
					</Button>
				</Flex>
			</Dialog.Content>
		</Dialog.Root>
	)
}

function DetailView({ node, privacyMode }: { node: NodeDetail; privacyMode: boolean }) {
	const { t } = useTranslation()
	const isMobile = useIsMobile()
	const { live_data } = useLiveData()
	const isOnline = live_data?.data?.online?.includes(node.uuid)

	return (
		<Drawer direction={isMobile ? 'bottom' : 'right'}>
			<DrawerTrigger asChild>
				<div className="h-8 flex items-center hover:underline cursor-pointer font-bold text-base gap-2">
					<Flag flag={node.region} size="6" />
					<span>{node.name.length > 25 ? node.name.slice(0, 25) + '...' : node.name}</span>
					<span
						className={`inline-flex h-2.5 w-2.5 rounded-full ${isOnline ? 'bg-green-500' : 'bg-(--gray-8)'}`}
						title={isOnline ? t('nodeCard.online', '在线') : t('nodeCard.offline', '离线')}
					/>
				</div>
			</DrawerTrigger>
			<DrawerContent>
				<DrawerHeader className="gap-1">
					<DrawerTitle>{node.name}</DrawerTitle>
					<DrawerDescription>{t('admin.nodeDetail.machineDetail', '机器详细信息')}</DrawerDescription>
				</DrawerHeader>
				<div className="flex flex-col gap-4 overflow-y-auto px-4 text-sm">
					<form className="flex flex-col gap-4">
						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
							<div className="flex flex-col gap-3">
								<label htmlFor="detail-ip">{t('admin.nodeDetail.ipAddress', 'IP 地址')}</label>
								<div className="flex flex-col gap-1">
									{node.ipv4 && (
										<div className="flex items-center gap-1">
											<span id="detail-ipv4" className="bg-muted px-3 py-2 rounded border flex-1 min-w-0 select-text">
												{privacyMode ? maskIp(node.ipv4) : node.ipv4}
											</span>
											{!privacyMode && (
												<IconButton
													variant="ghost"
													className="size-5"
													type="button"
													onClick={() => {
														navigator.clipboard.writeText(node.ipv4!)
													}}>
													<Copy size={16} />
												</IconButton>
											)}
										</div>
									)}
									{node.ipv6 && (
										<div className="flex items-center gap-1">
											<span id="detail-ipv6" className="bg-muted px-3 py-2 rounded border flex-1 min-w-0 select-text">
												{privacyMode ? maskIp(node.ipv6) : node.ipv6}
											</span>
											{!privacyMode && (
												<IconButton
													variant="ghost"
													className="size-5"
													type="button"
													onClick={() => {
														navigator.clipboard.writeText(node.ipv6!)
													}}>
													<Copy size={16} />
												</IconButton>
											)}
										</div>
									)}
								</div>
							</div>
							<div className="flex flex-col gap-3">
								<label htmlFor="detail-version">{t('admin.nodeDetail.clientVersion', '客户端版本')}</label>
								<span id="detail-version" className="bg-muted px-3 py-2 rounded border select-text">
									{node.version || <span className="text-muted-foreground">-</span>}
								</span>
							</div>
						</div>
						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
							<div className="flex flex-col gap-3">
								<label htmlFor="detail-os">{t('admin.nodeDetail.os', '操作系统')}</label>
								<span id="detail-os" className="bg-muted px-3 py-2 rounded border select-text">
									{node.os || <span className="text-muted-foreground">-</span>}
								</span>
							</div>
							<div className="flex flex-col gap-3">
								<label htmlFor="detail-arch">{t('admin.nodeDetail.arch', '架构')}</label>
								<span id="detail-arch" className="bg-muted px-3 py-2 rounded border select-text">
									{node.arch || <span className="text-muted-foreground">-</span>}
								</span>
							</div>
						</div>
						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
							<div className="flex flex-col gap-3">
								<label htmlFor="detail-cpu_name">{t('admin.nodeDetail.cpu', 'CPU')}</label>
								<span id="detail-cpu_name" className="bg-muted px-3 py-2 rounded border select-text">
									{node.cpu_name || <span className="text-muted-foreground">-</span>}
								</span>
							</div>
							<div className="flex flex-col gap-3">
								<label htmlFor="detail-cpu_cores">{t('admin.nodeDetail.cpuCores', 'CPU 核心数')}</label>
								<span id="detail-cpu_cores" className="bg-muted px-3 py-2 rounded border select-text">
									{node.cpu_cores?.toString() || <span className="text-muted-foreground">-</span>}
								</span>
							</div>
						</div>
						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
							<div className="flex flex-col gap-3">
								<label htmlFor="detail-mem_total">{t('admin.nodeDetail.memTotal', '总内存 (Bytes)')}</label>
								<span
									id="detail-mem_total"
									className="bg-muted px-3 py-2 rounded border select-text"
									title={node.mem_total ? String(node.mem_total) + ' Bytes' : '-'}>
									{formatBytes(node.mem_total)}
								</span>
							</div>
							<div className="flex flex-col gap-3">
								<label htmlFor="detail-disk_total">{t('admin.nodeDetail.diskTotal', '总磁盘空间 (Bytes)')}</label>
								<span
									id="detail-disk_total"
									className="bg-muted px-3 py-2 rounded border select-text"
									title={node.disk_total ? String(node.disk_total) + ' Bytes' : '-'}>
									{formatBytes(node.disk_total)}
								</span>
							</div>
						</div>
						<div className="flex flex-col gap-3">
							<label htmlFor="detail-gpu_name">{t('admin.nodeDetail.gpu', 'GPU')}</label>
							<span id="detail-gpu_name" className="bg-muted px-3 py-2 rounded border select-text">
								{node.gpu_name || <span className="text-muted-foreground">-</span>}
							</span>
						</div>
						<div className="flex flex-col gap-3">
							<label htmlFor="detail-uuid">{t('admin.nodeDetail.uuid', 'UUID')}</label>
							<span id="detail-uuid" className="bg-muted px-3 py-2 rounded border select-text">
								{node.uuid || <span className="text-muted-foreground">-</span>}
							</span>
						</div>
						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
							<div className="flex flex-col gap-3">
								<label htmlFor="detail-createdAt">{t('admin.nodeDetail.createdAt', '创建时间')}</label>
								<span id="detail-createdAt" className="bg-muted px-3 py-2 rounded border select-text">
									{node.created_at ? new Date(node.created_at).toLocaleString() : <span className="text-muted-foreground">-</span>}
								</span>
							</div>
							<div className="flex flex-col gap-3">
								<label htmlFor="detail-updatedAt">{t('admin.nodeDetail.updatedAt', '更新时间')}</label>
								<span id="detail-updatedAt" className="bg-muted px-3 py-2 rounded border select-text">
									{node.updated_at ? new Date(node.updated_at).toLocaleString() : <span className="text-muted-foreground">-</span>}
								</span>
							</div>
						</div>
					</form>
				</div>
				<DrawerFooter>
					<DrawerClose asChild>
						<Button>{t('admin.nodeDetail.done', '完成')}</Button>
					</DrawerClose>
				</DrawerFooter>
			</DrawerContent>
		</Drawer>
	)
}
