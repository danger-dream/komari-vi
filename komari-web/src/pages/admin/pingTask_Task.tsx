import NodeSelectorDialog from '@/components/NodeSelectorDialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useNodeDetails } from '@/contexts/NodeDetailsContext'
import { usePingTask, type PingTask } from '@/contexts/PingTaskContext'
import { Button, Dialog, Flex, IconButton, Select, TextField } from '@radix-ui/themes'
import { DndContext, KeyboardSensor, MouseSensor, TouchSensor, closestCenter, type DragEndEvent, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Copy, MenuIcon, MoreHorizontal, Pencil, Trash } from 'lucide-react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AddButton } from './pingTask'
import { maskTarget } from '@/utils/taskTarget'

type ProcessedTask = PingTask & {
	__allClientsDeleted?: boolean
	__originalCount?: number
}

const getTaskId = (task: PingTask) => (task.id !== undefined ? String(task.id) : `${task.target}-${task.name}`)

export const TaskView = ({ pingTasks, privacyMode }: { pingTasks: PingTask[]; privacyMode: boolean }) => {
	const { t } = useTranslation()
	const { nodeDetail } = useNodeDetails()
	const { refresh } = usePingTask()
	const sensors = useSensors(
		useSensor(MouseSensor, {
			activationConstraint: { distance: 10 }
		}),
		useSensor(TouchSensor, {
			activationConstraint: { delay: 200, tolerance: 6 }
		}),
		useSensor(KeyboardSensor, {})
	)
	const [isDragging, setIsDragging] = React.useState(false)

	// 过滤已删除的节点
	const processedTasks = React.useMemo<ProcessedTask[]>(() => {
		if (!pingTasks) return []
		const nodeUuidSet = new Set(nodeDetail.map(n => n.uuid))
		return pingTasks.map(task => {
			const original = task.clients || []
			const existing = original.filter(uuid => nodeUuidSet.has(uuid))
			const allDeleted = original.length > 0 && existing.length === 0
			return {
				...task,
				clients: existing,
				__allClientsDeleted: allDeleted,
				__originalCount: original.length
			}
		})
	}, [pingTasks, nodeDetail])

	const [localTasks, setLocalTasks] = React.useState<ProcessedTask[]>(processedTasks)

	React.useEffect(() => {
		setLocalTasks(processedTasks)
	}, [processedTasks])

	const handleDragEnd = async (event: DragEndEvent) => {
		const { active, over } = event
		setIsDragging(false)
		if (!over || active.id === over.id) return

		const oldIndex = localTasks.findIndex(task => getTaskId(task) === active.id)
		const newIndex = localTasks.findIndex(task => getTaskId(task) === over.id)
		if (oldIndex === -1 || newIndex === -1) return

		const previous = localTasks
		const reordered = arrayMove(localTasks, oldIndex, newIndex)
		setLocalTasks(reordered)

		const orderData = reordered.reduce<Record<string, number>>((acc, task, index) => {
			if (task.id !== undefined) {
				acc[String(task.id)] = index
			}
			return acc
		}, {})
		if ('vibrate' in navigator) {
			navigator.vibrate([30])
		}

		try {
			const res = await fetch('/api/admin/ping/order', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(orderData)
			})
			if (!res.ok) {
				throw new Error(t('common.error'))
			}
			refresh()
		} catch (err) {
			setLocalTasks(previous)
			toast.error(err instanceof Error ? err.message : t('common.error', 'Error'))
		}
	}

	return (
		<div className={`overflow-hidden ${isDragging ? 'select-none' : ''}`}>
			<DndContext
				sensors={sensors}
				collisionDetection={closestCenter}
				onDragStart={() => {
					setIsDragging(true)
					if ('vibrate' in navigator) navigator.vibrate(20)
				}}
				onDragEnd={handleDragEnd}
				onDragCancel={() => setIsDragging(false)}>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="w-10" />
							<TableHead>{t('common.name')}</TableHead>
							<TableHead>{t('common.server')}</TableHead>
							<TableHead>{t('ping.target')}</TableHead>
							<TableHead>{t('ping.type')}</TableHead>
							<TableHead>{t('ping.interval')}</TableHead>
							<TableHead>{t('common.action')}</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						<SortableContext items={localTasks.map(task => getTaskId(task))} strategy={verticalListSortingStrategy}>
							{localTasks.map(task => (
								<Row key={getTaskId(task)} task={task} privacyMode={privacyMode} />
							))}
						</SortableContext>
					</TableBody>
				</Table>
			</DndContext>
		</div>
	)
}

const Row = ({ task, privacyMode }: { task: ProcessedTask; privacyMode: boolean }) => {
	const { t } = useTranslation()
	const { refresh } = usePingTask()
	const { nodeDetail } = useNodeDetails()
	const [editOpen, setEditOpen] = React.useState(false)
	const [editSaving, setEditSaving] = React.useState(false)
	const [deleteOpen, setDeleteOpen] = React.useState(false)
	const [deleteLoading, setDeleteLoading] = React.useState(false)
	const [form, setForm] = React.useState({
		name: task.name || '',
		type: task.type || 'icmp',
		target: task.target || '',
		clients: task.clients || [],
		interval: task.interval || 60
	})

	const submitEdit = (newForm: typeof form) => {
		setEditSaving(true)
		fetch('/api/admin/ping/edit', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				tasks: [
					{
						id: task.id,
						name: newForm.name,
						type: newForm.type,
						target: newForm.target,
						clients: newForm.clients,
						interval: newForm.interval
					}
				]
			})
		})
			.then(res => {
				if (!res.ok) {
					return res.json().then(data => {
						throw new Error(data?.message || t('common.error'))
					})
				}
				return res.json()
			})
			.then(() => {
				setEditOpen(false)
				toast.success(t('common.updated_successfully'))
				refresh()
			})
			.catch(error => {
				toast.error(error.message)
			})
			.finally(() => setEditSaving(false))
	}

	// 编辑提交
	const handleEdit = (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault()
		submitEdit(form)
	}

	// 删除
	const handleDelete = () => {
		setDeleteLoading(true)
		fetch('/api/admin/ping/delete', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id: [task.id] })
		})
			.then(res => {
				if (!res.ok) {
					return res.json().then(data => {
						throw new Error(data?.message || t('common.error'))
					})
				}
				return res.json()
			})
			.then(() => {
				setDeleteOpen(false)
				toast.success(t('common.deleted_successfully'))
				refresh()
			})
			.catch(error => {
				toast.error(error.message)
			})
			.finally(() => setDeleteLoading(false))
	}

	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: getTaskId(task) })
	const style = {
		transform: CSS.Transform.toString(transform),
		transition
	}

	return (
		<TableRow key={getTaskId(task)} ref={setNodeRef} style={style} className={isDragging ? 'opacity-70' : ''}>
			<TableCell className="w-10">
				<div
					{...attributes}
					{...listeners}
					className="cursor-move rounded p-1 hover:bg-[var(--accent-3)]"
					style={{
						touchAction: 'none',
						WebkitUserSelect: 'none',
						userSelect: 'none'
					}}
					title={t('admin.nodeTable.dragToReorder', '长按拖拽重新排序')}>
					<MenuIcon size={16} className="text-[var(--accent-11)]" />
				</div>
			</TableCell>
			<TableCell>{task.name}</TableCell>
			<TableCell>
				<Flex gap="2" align="center">
					{task.clients && task.clients.length > 0
						? (() => {
								const names = task.clients.map(uuid => {
									const name = nodeDetail.find(node => node.uuid === uuid)?.name || uuid
									return name
								})
								const joined = names.join(', ')
								return joined.length > 40 ? joined.slice(0, 40) + '...' : joined
						  })()
						: t('common.none')}
					<NodeSelectorDialog
						value={form.clients ?? []}
						onChange={uuids => {
							setForm(f => ({ ...f, clients: uuids }))
							submitEdit({ ...form, clients: uuids })
						}}
						showViewModeToggle>
						<IconButton variant="ghost">
							<MoreHorizontal size="16" />
						</IconButton>
					</NodeSelectorDialog>
				</Flex>
			</TableCell>
			<TableCell title={privacyMode ? maskTarget(task.target || '') : task.target}>
				{privacyMode ? maskTarget(task.target || '') : task.target}
			</TableCell>
			<TableCell>{task.type}</TableCell>
			<TableCell>{task.interval}</TableCell>
			<TableCell className="flex items-center gap-2">
				<AddButton
					preset={{
						name: `${task.name || ''}_复制`,
						target: task.target,
						type: task.type as 'icmp' | 'tcp' | 'http',
						clients: task.clients ?? [],
						interval: task.interval
					}}>
					<IconButton variant="soft" color="mint" title={t('common.copy')}>
						<Copy size="16" />
					</IconButton>
				</AddButton>
				{/* 编辑按钮 */}
				<Dialog.Root open={editOpen} onOpenChange={setEditOpen}>
					<Dialog.Trigger>
						<IconButton variant="soft">
							<Pencil size="16" />
						</IconButton>
					</Dialog.Trigger>
					<Dialog.Content>
						<Dialog.Title>{t('common.edit')}</Dialog.Title>
						<form onSubmit={handleEdit} className="flex flex-col gap-2">
							<label>{t('common.name')}</label>
							<TextField.Root value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
							<label>{t('ping.type')}</label>
							<Select.Root value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v as any }))}>
								<Select.Trigger />
								<Select.Content>
									<Select.Item value="icmp">ICMP</Select.Item>
									<Select.Item value="tcp">TCP</Select.Item>
									<Select.Item value="http">HTTP</Select.Item>
								</Select.Content>
							</Select.Root>
							<label>{t('ping.target')}</label>
							<TextField.Root value={form.target} onChange={e => setForm(f => ({ ...f, target: e.target.value }))} required />
							<label>{t('common.server')}</label>
							<Flex>
								<NodeSelectorDialog value={form.clients} onChange={v => setForm(f => ({ ...f, clients: v }))} showViewModeToggle />
							</Flex>
							<label>
								{t('ping.interval')} ({t('time.second')})
							</label>
							<TextField.Root
								type="number"
								value={form.interval}
								onChange={e => setForm(f => ({ ...f, interval: Number(e.target.value) }))}
								required
							/>
							<Flex gap="2" justify="end" className="mt-4">
								<Dialog.Close>
									<Button variant="soft" color="gray" type="button" onClick={() => setEditOpen(false)}>
										{t('common.cancel')}
									</Button>
								</Dialog.Close>
								<Button variant="solid" type="submit" disabled={editSaving}>
									{t('common.save')}
								</Button>
							</Flex>
						</form>
					</Dialog.Content>
				</Dialog.Root>
				{/* 删除按钮 */}
				<Dialog.Root open={deleteOpen} onOpenChange={setDeleteOpen}>
					<Dialog.Trigger>
						<IconButton variant="soft" color="red">
							<Trash size="16" />
						</IconButton>
					</Dialog.Trigger>
					<Dialog.Content>
						<Dialog.Title>{t('common.delete')}</Dialog.Title>
						<Flex gap="2" justify="end" className="mt-4">
							<Dialog.Close>
								<Button variant="soft" color="gray" type="button" onClick={() => setDeleteOpen(false)}>
									{t('common.cancel')}
								</Button>
							</Dialog.Close>
							<Button variant="solid" color="red" onClick={handleDelete} disabled={deleteLoading}>
								{t('common.delete')}
							</Button>
						</Flex>
					</Dialog.Content>
				</Dialog.Root>
			</TableCell>
		</TableRow>
	)
}
