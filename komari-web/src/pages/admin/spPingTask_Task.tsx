import NodeSelectorDialog from '@/components/NodeSelectorDialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useNodeDetails } from '@/contexts/NodeDetailsContext'
import { useSPPingTask, type SPPingTask } from '@/contexts/SPPingTaskContext'
import { SPTaskFormFields, buildDefaultSPTaskForm, type SPTaskFormState } from '@/pages/admin/spPingTask_Form'
import { Button, Dialog, Flex, IconButton } from '@radix-ui/themes'
import { DndContext, KeyboardSensor, MouseSensor, TouchSensor, closestCenter, type DragEndEvent, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { MenuIcon, MoreHorizontal, Pencil, Trash } from 'lucide-react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { maskTarget } from '@/utils/taskTarget'

type ProcessedTask = SPPingTask & {
	__allClientsDeleted?: boolean
	__originalCount?: number
}

const getTaskId = (task: SPPingTask) => (task.id !== undefined ? String(task.id) : `${task.target}-${task.name}`)

export const TaskView = ({ tasks, privacyMode }: { tasks: SPPingTask[]; privacyMode: boolean }) => {
	const { t } = useTranslation()
	const { nodeDetail } = useNodeDetails()
	const { refresh } = useSPPingTask()
	const sensors = useSensors(
		useSensor(MouseSensor, { activationConstraint: { distance: 10 } }),
		useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
		useSensor(KeyboardSensor, {})
	)
	const [isDragging, setIsDragging] = React.useState(false)

	const processedTasks = React.useMemo<ProcessedTask[]>(() => {
		if (!tasks) return []
		const nodeUuidSet = new Set(nodeDetail.map(n => n.uuid))
		return tasks.map(task => {
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
	}, [tasks, nodeDetail])

	const [localTasks, setLocalTasks] = React.useState<ProcessedTask[]>(processedTasks)
	React.useEffect(() => setLocalTasks(processedTasks), [processedTasks])

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

		try {
			const res = await fetch('/api/admin/sp-ping/order', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ weights: orderData })
			})
			if (!res.ok) {
				throw new Error(t('common.error'))
			}
			toast.success(t('common.success'))
			refresh()
		} catch (err) {
			setLocalTasks(previous)
			toast.error(err instanceof Error ? err.message : t('common.error'))
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
							<TableHead className="w-[130px]">{t('common.name')}</TableHead>
							<TableHead className="w-[340px]">{t('common.server')}</TableHead>
							<TableHead className="w-20">{t('spPing.type')}</TableHead>
							<TableHead className="w-[160px]">{t('spPing.target')}</TableHead>
							<TableHead className="w-20">{t('spPing.step')}</TableHead>
							<TableHead className="w-20">{t('spPing.pings')}</TableHead>
							<TableHead className="w-20">{t('common.action')}</TableHead>
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
	const { refresh } = useSPPingTask()
	const { nodeDetail } = useNodeDetails()
	const [editOpen, setEditOpen] = React.useState(false)
	const [editSaving, setEditSaving] = React.useState(false)
	const [deleteOpen, setDeleteOpen] = React.useState(false)
	const [deleteLoading, setDeleteLoading] = React.useState(false)
	const buildForm = React.useCallback(() => buildDefaultSPTaskForm(task as Partial<SPTaskFormState>), [task])

	const [form, setForm] = React.useState<SPTaskFormState>(buildForm)

	React.useEffect(() => {
		if (editOpen) {
			setForm(buildForm())
		}
	}, [editOpen, buildForm])

	const submitEdit = (newForm: typeof form) => {
		setEditSaving(true)
		const payloadTask = {
			id: task.id,
			name: newForm.name?.trim() || '',
			type: newForm.type,
			target: newForm.target?.trim() || '',
			clients: Array.isArray(newForm.clients) ? newForm.clients : [],
			step: newForm.step || 0,
			pings: newForm.pings || 0,
			timeout_ms: newForm.timeout_ms || 0,
			payload_size: newForm.payload_size || 0
		}
		fetch('/api/admin/sp-ping/edit', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				tasks: [payloadTask]
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

	const handleEdit = (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault()
		submitEdit(form)
	}

	const handleDelete = () => {
		setDeleteLoading(true)
		fetch('/api/admin/sp-ping/delete', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id: [task.id] })
		})
			.then(res => {
				if (!res.ok)
					return res.json().then(d => {
						throw new Error(d?.message || t('common.error'))
					})
				return res.json()
			})
			.then(() => {
				toast.success(t('common.deleted_successfully'))
				refresh()
			})
			.catch(error => toast.error(error.message))
			.finally(() => {
				setDeleteOpen(false)
				setDeleteLoading(false)
			})
	}

	const deletedBadge =
		task.__allClientsDeleted && task.__originalCount ? (
			<span className="text-xs text-amber-10">{t('ping.missing_nodes', { count: task.__originalCount })}</span>
		) : null

	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: getTaskId(task) })
	const style: React.CSSProperties = {
		transform: CSS.Transform.toString(transform),
		transition
	}

	return (
		<TableRow
			ref={setNodeRef}
			style={style}
			className={`${task.__allClientsDeleted ? 'opacity-70' : ''} ${isDragging ? 'opacity-70' : ''}`}>
			<TableCell className="w-10">
				<SortableHandle attributes={attributes} listeners={listeners} />
			</TableCell>
			<TableCell className="w-[130px]">
				<div className="flex flex-col gap-1">
					<span className="font-medium">{task.name}</span>
					{deletedBadge}
				</div>
			</TableCell>
			<TableCell className="max-w-[520px]">
				<Flex gap="2" align="center" wrap="wrap">
					{task.clients && task.clients.length > 0
						? (() => {
								const names = task.clients.map(uuid => nodeDetail.find(node => node.uuid === uuid)?.name || uuid)
								const joined = names.join(', ')
								return joined.length > 60 ? joined.slice(0, 60) + '...' : joined
						  })()
						: t('common.none')}
					<NodeSelectorDialog
						value={form.clients ?? []}
						onChange={uuids => {
							setForm(f => ({ ...f, clients: uuids }))
							submitEdit({ ...form, clients: uuids })
						}}
						showViewModeToggle>
						<IconButton variant="ghost" size="1">
							<MoreHorizontal size={16} />
						</IconButton>
					</NodeSelectorDialog>
				</Flex>
			</TableCell>
			<TableCell className="uppercase w-20">{task.type}</TableCell>
			<TableCell className="font-mono max-w-[200px] truncate" title={privacyMode ? maskTarget(task.target || '') : task.target}>
				{privacyMode ? maskTarget(task.target || '') : task.target}
			</TableCell>
			<TableCell className="w-20">{task.step}</TableCell>
			<TableCell className="w-20">{task.pings}</TableCell>
			<TableCell className="w-20">
				<Flex gap="3">
					<Dialog.Root open={editOpen} onOpenChange={setEditOpen}>
						<Dialog.Trigger>
							<IconButton variant="ghost" size="2">
								<Pencil size={16} />
							</IconButton>
						</Dialog.Trigger>
						<Dialog.Content style={{ maxWidth: 560 }}>
							<Dialog.Title>{t('spPing.edit')}</Dialog.Title>
							<form onSubmit={handleEdit} className="space-y-3">
								<SPTaskFormFields form={form} onChange={patch => setForm(prev => ({ ...prev, ...patch }))} />
								<div className="text-xs text-(--gray-11) bg-(--gray-3) border border-(--gray-5) rounded-md px-3 py-2 leading-relaxed">
									{t('spPing.how_it_works')}
								</div>
								<Flex gap="3" justify="end" pt="2">
									<Dialog.Close>
										<Button variant="soft" color="gray" size="2" type="button">
											{t('common.cancel')}
										</Button>
									</Dialog.Close>
									<Button type="submit" size="2" disabled={editSaving}>
										{t('common.save')}
									</Button>
								</Flex>
							</form>
						</Dialog.Content>
					</Dialog.Root>
					<Dialog.Root open={deleteOpen} onOpenChange={setDeleteOpen}>
						<Dialog.Trigger>
							<IconButton variant="ghost" color="red" size="2">
								<Trash size={16} />
							</IconButton>
						</Dialog.Trigger>
						<Dialog.Content style={{ maxWidth: 360 }}>
							<Dialog.Title>{t('common.delete')}</Dialog.Title>
							<p>{t('common.confirm_delete')}</p>
							<Flex gap="3" justify="end" pt="2">
								<Dialog.Close>
									<Button variant="soft" color="gray" size="2" type="button">
										{t('common.cancel')}
									</Button>
								</Dialog.Close>
								<Button color="red" onClick={handleDelete} disabled={deleteLoading} size="2">
									{t('common.delete')}
								</Button>
							</Flex>
						</Dialog.Content>
					</Dialog.Root>
				</Flex>
			</TableCell>
		</TableRow>
	)
}

const SortableHandle = ({
	attributes,
	listeners
}: {
	attributes: React.HTMLAttributes<HTMLDivElement>
	listeners: React.HTMLAttributes<HTMLDivElement>
}) => {
	return (
		<div
			{...attributes}
			{...listeners}
			className="cursor-move rounded p-1 text-(--gray-9) hover:bg-(--accent-a3)"
			style={{
				touchAction: 'none',
				WebkitUserSelect: 'none',
				userSelect: 'none'
			}}>
			<MenuIcon size={16} />
		</div>
	)
}
