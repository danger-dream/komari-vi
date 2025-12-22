import { useEffect, useState } from 'react'
import { Dialog, Button, Flex, Select, Text, TextArea } from '@radix-ui/themes'
import { ReloadIcon, TrashIcon } from '@radix-ui/react-icons'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

type LogNode = {
	node_id: string
	node_name?: string
}

type Props = {
	open: boolean
	ruleId?: number
	onClose: () => void
}

const RuleLogsDialog = ({ open, ruleId, onClose }: Props) => {
	const { t } = useTranslation()
	const [nodes, setNodes] = useState<LogNode[]>([])
	const [loading, setLoading] = useState(false)
	const [nodeId, setNodeId] = useState('')
	const [content, setContent] = useState('')
	const [lines, setLines] = useState(200)

	const fetchNodes = async () => {
		if (!ruleId) return
		try {
			const res = await fetch(`/api/v1/forwards/${ruleId}/logs`)
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			const body = await res.json()
			const list = body.data || []
			setNodes(list)
			if (!nodeId && list.length > 0) {
				setNodeId(list[0].node_id)
			}
		} catch (e: any) {
			toast.error(e?.message || 'Load failed')
		}
	}

	const fetchLog = async () => {
		if (!ruleId || !nodeId) return
		setLoading(true)
		try {
			const res = await fetch(`/api/v1/forwards/${ruleId}/logs/${nodeId}?lines=${lines}`)
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			const body = await res.json()
			const payload = typeof body.data?.payload === 'string' ? JSON.parse(body.data.payload) : body.data?.payload
			const logContent = payload?.log_content || ''
			setContent(logContent || body.data?.message || '')
		} catch (e: any) {
			toast.error(e?.message || 'Load failed')
		} finally {
			setLoading(false)
		}
	}

	const clearLog = async () => {
		if (!ruleId || !nodeId) return
		try {
			const res = await fetch(`/api/v1/forwards/${ruleId}/logs/${nodeId}/clear`, { method: 'POST' })
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			toast.success(t('common.success'))
			fetchLog()
		} catch (e: any) {
			toast.error(e?.message || 'Clear failed')
		}
	}

	const deleteLog = async () => {
		if (!ruleId || !nodeId) return
		try {
			const res = await fetch(`/api/v1/forwards/${ruleId}/logs/${nodeId}`, { method: 'DELETE' })
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			toast.success(t('common.success'))
			setContent('')
		} catch (e: any) {
			toast.error(e?.message || 'Delete failed')
		}
	}

	useEffect(() => {
		if (open) {
			fetchNodes()
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open])

	useEffect(() => {
		if (open && nodeId) {
			fetchLog()
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [nodeId, open])

	return (
		<Dialog.Root open={open} onOpenChange={o => (!o ? onClose() : null)}>
			<Dialog.Content maxWidth="720px">
				<Dialog.Title>{t('forward.logs', { defaultValue: 'Realm日志' })}</Dialog.Title>
				<Flex gap="2" align="center" mb="3">
					<Select.Root value={nodeId} onValueChange={setNodeId}>
						<Select.Trigger />
						<Select.Content>
							{nodes.map(n => (
								<Select.Item key={n.node_id} value={n.node_id}>
									{n.node_name || n.node_id}
								</Select.Item>
							))}
						</Select.Content>
					</Select.Root>
					<Button variant="ghost" onClick={fetchLog} disabled={loading}>
						<ReloadIcon /> {t('forward.refresh')}
					</Button>
					<Button variant="soft" onClick={clearLog}>
						{t('forward.clear', { defaultValue: '清空' })}
					</Button>
					<Button variant="soft" color="red" onClick={deleteLog}>
						<TrashIcon /> {t('forward.delete', { defaultValue: '删除' })}
					</Button>
				</Flex>
				<TextArea value={content} minRows={16} readOnly className="font-mono" />
				<Flex justify="end" mt="3">
					<Button variant="soft" onClick={onClose}>
						{t('common.close')}
					</Button>
				</Flex>
			</Dialog.Content>
		</Dialog.Root>
	)
}

export default RuleLogsDialog
