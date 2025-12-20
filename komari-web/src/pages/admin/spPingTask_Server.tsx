import { useNodeDetails } from '@/contexts/NodeDetailsContext'
import { useSPPingTask, type SPPingTask } from '@/contexts/SPPingTaskContext'
import { Button, Dialog, Flex, Text, Badge, IconButton } from '@radix-ui/themes'
import { ClipboardCopy, ClipboardPaste, MoreHorizontal } from 'lucide-react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Selector } from '@/components/Selector'
import Flag from '@/components/Flag'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import ServerViewModeControl, { type ServerViewMode } from '@/components/server/ServerViewModeControl'
import ServerGroupedTableBody from '@/components/server/ServerGroupedTableBody'

export const ServerView = ({ tasks }: { tasks: SPPingTask[] }) => {
	const { t } = useTranslation()
	const { nodeDetail } = useNodeDetails()
	const [viewMode, setViewMode] = React.useState<ServerViewMode>('list')
	const [copyBuffer, setCopyBuffer] = React.useState<{ ids: string[]; from: string } | null>(null)

	const sortedNodes = React.useMemo(() => [...nodeDetail], [nodeDetail])

	return (
		<div className="relative">
			{copyBuffer && (
				<div className="absolute right-3 top-3 z-20 rounded-md border border-accent-7 bg-accent-2 px-3 py-2 flex items-center gap-3 shadow-lg">
					<Text size="2" weight="medium" color="gray">
						{t('ping.copy_notice', {
							defaultValue: '复制任务配置中：{{server}} ({{count}})',
							server: copyBuffer.from,
							count: copyBuffer.ids.length
						})}
					</Text>
					<Button size="2" variant="solid" color="gray" onClick={() => setCopyBuffer(null)}>
						{t('common.cancel')}
					</Button>
				</div>
			)}
			<Flex justify="end" className="mb-3">
				<ServerViewModeControl value={viewMode} onValueChange={setViewMode} size="1" />
			</Flex>
			<div className="overflow-hidden">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="w-[180px]">{t('common.server')}</TableHead>
							<TableHead className="w-[400px]">{t('spPing.title')}</TableHead>
							<TableHead className="w-[120px]">{t('common.action')}</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						<ServerGroupedTableBody
							items={sortedNodes}
							viewMode={viewMode}
							colSpan={3}
							ungroupedLabel={t('common.ungrouped', { defaultValue: '未分组' })}
							unknownRegionLabel={t('common.unknown_region', { defaultValue: '未知地域' })}
							renderRow={n => <ServerRow key={n.uuid} node={n} tasks={tasks} copyBuffer={copyBuffer} onCopyBufferChange={setCopyBuffer} />}
						/>
					</TableBody>
				</Table>
			</div>
		</div>
	)
}

const ServerRow: React.FC<{
	node: { uuid: string; name: string; region?: string; group?: string }
	tasks: SPPingTask[]
	copyBuffer: { ids: string[]; from: string } | null
	onCopyBufferChange: (buf: { ids: string[]; from: string } | null) => void
}> = ({ node, tasks, copyBuffer, onCopyBufferChange }) => {
	const { uuid: nodeUuid, name: nodeName, region } = node
	const { t } = useTranslation()
	const { refresh } = useSPPingTask()
	const [open, setOpen] = React.useState(false)
	const [saving, setSaving] = React.useState(false)

	const ownedTasks = React.useMemo(() => tasks.filter(t => t.clients?.includes(nodeUuid)), [tasks, nodeUuid])
	const [selectedIds, setSelectedIds] = React.useState<string[]>(() => ownedTasks.filter(t => t.id !== undefined).map(t => String(t.id)))

	React.useEffect(() => {
		setSelectedIds(ownedTasks.filter(t => t.id !== undefined).map(t => String(t.id)))
	}, [ownedTasks])

	const handleSave = (idsOverride?: string[]) => {
		setSaving(true)
		const targetIds = idsOverride ?? selectedIds
		const toUpdate = tasks
			.filter(task => task.id !== undefined)
			.filter(task => {
				const hasBefore = !!task.clients?.includes(nodeUuid)
				const hasAfter = targetIds.includes(String(task.id))
				return hasBefore !== hasAfter
			})
			.map(task => {
				const hasAfter = targetIds.includes(String(task.id))
				const current = new Set(task.clients || [])
				if (hasAfter) current.add(nodeUuid)
				else current.delete(nodeUuid)
				return {
					id: task.id,
					name: task.name,
					type: task.type,
					target: task.target,
					clients: Array.from(current),
					step: task.step,
					pings: task.pings,
					timeout_ms: task.timeout_ms,
					payload_size: task.payload_size
				}
			})

		if (toUpdate.length === 0) {
			setOpen(false)
			setSaving(false)
			return
		}

		fetch('/api/admin/sp-ping/edit', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ tasks: toUpdate })
		})
			.then(res => {
				if (!res.ok)
					return res.json().then(d => {
						throw new Error(d?.message || t('common.error'))
					})
				return res.json()
			})
			.then(() => {
				toast.success(t('common.success'))
				refresh()
				setOpen(false)
			})
			.catch(error => toast.error(error.message))
			.finally(() => setSaving(false))
	}

	const hasCopy = copyBuffer && copyBuffer.ids.length > 0
	const isSelfCopy = copyBuffer?.from === nodeName
	const canPaste = !!hasCopy && !isSelfCopy

	return (
		<TableRow>
			<TableCell>
				<Flex align="center" gap="2">
					<Flag flag={region ?? ''} size="4" />
					<Text weight="medium">{nodeName}</Text>
				</Flex>
			</TableCell>
			<TableCell>
				{ownedTasks.length > 0 ? (() => {
					const joined = ownedTasks.map(t => t.name).join(', ')
					return joined.length > 50 ? joined.slice(0, 50) + '...' : joined
				})() : (
					<Text size="2" color="gray">
						{t('common.none')}
					</Text>
				)}
			</TableCell>
			<TableCell>
				<Flex gap="1" align="center">
					<IconButton
						size="1"
						variant="ghost"
						onClick={() => onCopyBufferChange({ ids: selectedIds, from: nodeName })}
						title={t('common.copy', { defaultValue: 'Copy' })}>
						<ClipboardCopy size={14} />
					</IconButton>
					<IconButton
						size="1"
						variant="ghost"
						color={hasCopy ? undefined : 'gray'}
						disabled={!canPaste}
						onClick={() => {
							if (!canPaste || !copyBuffer) return
							setSelectedIds(copyBuffer.ids)
							handleSave(copyBuffer.ids)
						}}
						title={
							canPaste
								? t('common.paste', { defaultValue: 'Paste' })
								: hasCopy
								? t('ping.copy_paste_block', {
										defaultValue: '无法粘贴到同一服务器'
								  })
								: t('ping.copy_first', {
										defaultValue: '请先复制一个服务器的任务'
								  })
						}>
						<ClipboardPaste size={14} />
					</IconButton>
					<Dialog.Root open={open} onOpenChange={setOpen}>
						<Dialog.Trigger>
							<IconButton variant="ghost">
								<MoreHorizontal size={16} />
							</IconButton>
						</Dialog.Trigger>
						<Dialog.Content maxWidth="450px" style={{ maxHeight: '80vh', overflow: 'hidden' }}>
							<Dialog.Title>
								<Flex align="center" gap="2">
									<Flag flag={region ?? ''} size="4" />
									{nodeName}
								</Flex>
							</Dialog.Title>
							<div className="mt-2">
								<Selector
									value={selectedIds}
									onChange={setSelectedIds}
									items={tasks.filter(t => t.id !== undefined)}
									getId={task => String(task.id)}
									getLabel={task => (
										<Flex align="center" justify="between" className="w-full">
											<span className="text-sm flex-1">{task.name}</span>
											<Badge size="1" variant="surface" color="gray">
												{`${task.type?.toUpperCase() || ''}${task.step ? `/${task.step}s` : ''}`}
											</Badge>
										</Flex>
									)}
									headerLabel={t('spPing.title')}
									searchPlaceholder={t('common.search', { defaultValue: 'Search' })}
									filterItem={(item, keyword) => String(item.name).toLowerCase().includes(keyword.toLowerCase())}
									maxHeight="55vh"
								/>
							</div>
							<Flex gap="2" justify="end" className="mt-4">
								<Dialog.Close>
									<Button variant="soft" color="gray" type="button" onClick={() => setOpen(false)}>
										{t('common.cancel')}
									</Button>
								</Dialog.Close>
								<Button onClick={() => handleSave()} disabled={saving}>
									{t('common.save')}
								</Button>
							</Flex>
						</Dialog.Content>
					</Dialog.Root>
				</Flex>
			</TableCell>
		</TableRow>
	)
}
