import { useNodeDetails } from '@/contexts/NodeDetailsContext'
import { usePingTask, type PingTask } from '@/contexts/PingTaskContext'
import { Button, Dialog, Flex, IconButton, Text, Badge } from '@radix-ui/themes'
import { ClipboardCopy, ClipboardPaste, MoreHorizontal } from 'lucide-react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Selector } from '@/components/Selector'
import Flag from '@/components/Flag'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import ServerViewModeControl, { type ServerViewMode } from '@/components/server/ServerViewModeControl'
import ServerGroupedTableBody from '@/components/server/ServerGroupedTableBody'

// 服务器视图：按服务器聚合展示其绑定的任务，并可快速增删绑定
export const ServerView = ({ pingTasks }: { pingTasks: PingTask[] }) => {
	const { t } = useTranslation()
	const { nodeDetail } = useNodeDetails()
	const [viewMode, setViewMode] = React.useState<ServerViewMode>('list')
	const [copyBuffer, setCopyBuffer] = React.useState<{
		ids: string[]
		from: string
	} | null>(null)

	const sortedNodes = React.useMemo(() => [...nodeDetail], [nodeDetail])

	return (
		<div className="relative">
			{copyBuffer && (
				<div className="absolute right-3 top-3 z-20 rounded-md border border-[var(--accent-7)] bg-[var(--accent-2)] px-3 py-2 flex items-center gap-3 shadow-lg">
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
							<TableHead className="w-[400px]">{t('ping.task')}</TableHead>
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
							renderRow={n => (
								<ServerRow key={n.uuid} node={n} pingTasks={pingTasks} copyBuffer={copyBuffer} onCopyBufferChange={setCopyBuffer} />
							)}
						/>
					</TableBody>
				</Table>
			</div>
		</div>
	)
}

const ServerRow: React.FC<{
	node: { uuid: string; name: string; region?: string; group?: string }
	pingTasks: PingTask[]
	copyBuffer: { ids: string[]; from: string } | null
	onCopyBufferChange: (buf: { ids: string[]; from: string } | null) => void
}> = ({ node, pingTasks, copyBuffer, onCopyBufferChange }) => {
	const { uuid: nodeUuid, name: nodeName, region } = node
	const { t } = useTranslation()
	const { refresh } = usePingTask()
	const [open, setOpen] = React.useState(false)
	const [saving, setSaving] = React.useState(false)

	// 当前服务器拥有的任务集合
	const ownedTasks = React.useMemo(() => pingTasks.filter(t => t.clients?.includes(nodeUuid)), [pingTasks, nodeUuid])

	// 编辑状态（所选任务 id 集合）
	const [selectedIds, setSelectedIds] = React.useState<string[]>(() => ownedTasks.filter(t => t.id !== undefined).map(t => String(t.id)))

	// 若任务或服务器改变，重置选择
	React.useEffect(() => {
		setSelectedIds(ownedTasks.filter(t => t.id !== undefined).map(t => String(t.id)))
	}, [ownedTasks])

	const handleSave = (idsOverride?: string[]) => {
		setSaving(true)
		const targetIds = idsOverride ?? selectedIds
		// 收集需要更新的任务（ membership 发生变化 ）
		const toUpdate = pingTasks
			.filter(task => task.id !== undefined)
			.filter(task => {
				const hasBefore = !!task.clients?.includes(nodeUuid)
				const hasAfter = targetIds.includes(String(task.id))
				return hasBefore !== hasAfter // 仅当变化才提交
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
					// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
					target: task.target!,
					clients: Array.from(current),
					interval: task.interval
				}
			})

		if (toUpdate.length === 0) {
			setOpen(false)
			setSaving(false)
			return
		}

		fetch('/api/admin/ping/edit', {
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
				toast.success(t('common.updated_successfully'))
				setOpen(false)
				refresh()
			})
			.catch(e => toast.error(e.message))
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
									items={[...pingTasks.filter(t => t.id !== undefined)].reverse()}
									getId={task => String(task.id)}
									getLabel={task => (
										<Flex align="center" justify="between" className="w-full">
											<span className="text-sm flex-1">{task.name}</span>
											<Badge size="1" variant="surface" color="gray">
												{task.type}/{task.interval}s
											</Badge>
										</Flex>
									)}
									headerLabel={t('ping.task')}
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
