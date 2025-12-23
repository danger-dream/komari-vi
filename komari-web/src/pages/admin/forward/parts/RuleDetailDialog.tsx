import { Dialog, Box, Flex, Text, TextArea, Button, Select } from '@radix-ui/themes'
import { useTranslation } from 'react-i18next'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import type { ForwardRule } from '..'
import { useNodeDetails } from '@/contexts/NodeDetailsContext'

type Props = {
	rule: ForwardRule | null
	onClose: () => void
}

const RuleDetailDialog = ({ rule, onClose }: Props) => {
	const { t } = useTranslation()
	const { nodeDetail } = useNodeDetails()
	const [toml, setToml] = useState('')
	const [saving, setSaving] = useState(false)
	const [previewLoading, setPreviewLoading] = useState(false)
	const [nodeConfigs, setNodeConfigs] = useState<Record<string, string>>({})
	const [activeNode, setActiveNode] = useState('')

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

	return (
		<Dialog.Root open={Boolean(rule)} onOpenChange={open => (!open ? onClose() : null)}>
			<Dialog.Content maxWidth="720px">
				<Dialog.Title>{rule?.name}</Dialog.Title>
				<Flex direction="column" gap="2" className="text-sm text-gray-700">
					<Text>
						{t('forward.type')}: {rule?.type}
					</Text>
					<Text>
						{t('forward.status')}: {rule?.status}
					</Text>
					<Text>
						{t('forward.group')}: {rule?.group_name || '-'}
					</Text>
					<Text>
						{t('forward.entry')}: {rule?.config_json ? '' : '-'}
					</Text>
					<Box className="bg-gray-50 border rounded p-3 overflow-auto max-h-96 whitespace-pre-wrap">
						{rule?.config_json || t('forward.configPlaceholder')}
					</Box>
					{nodeOptions.length > 0 && (
						<Box className="bg-gray-50 border rounded p-3 space-y-2">
							<Flex justify="between" align="center">
								<Text weight="bold">{t('forward.previewConfig')}</Text>
								<Button variant="ghost" size="1" onClick={applyConfigs} disabled={rule?.status !== 'running'}>
									{t('forward.applyConfigs')}
								</Button>
							</Flex>
							<Flex direction="column" gap="2">
								<Text>{t('forward.selectNode')}</Text>
								<Select.Root value={activeNode} onValueChange={setActiveNode}>
									<Select.Trigger />
									<Select.Content>
										{nodeOptions.map(node => (
											<Select.Item key={node.id} value={node.id}>
												{node.label}
											</Select.Item>
										))}
									</Select.Content>
								</Select.Root>
							</Flex>
							{previewLoading && (
								<Text size="1" color="gray">
									{t('forward.previewLoading')}
								</Text>
							)}
							<TextArea minRows={8} value={nodeConfigs[activeNode] || ''} readOnly />
						</Box>
					)}
					<Text className="mt-2">Realm TOML</Text>
					<TextArea minRows={10} value={toml} onChange={e => setToml(e.target.value)} />
					<Flex justify="end" gap="2">
						<Button variant="soft" onClick={() => setToml(rule?.realm_config || '')}>
							{t('common.cancel')}
						</Button>
						<Button onClick={saveToml} disabled={saving}>
							{t('forward.submit')}
						</Button>
					</Flex>
				</Flex>
				<Flex justify="end" mt="4">
					<button className="px-3 py-1 rounded bg-gray-100" onClick={onClose}>
						{t('forward.cancel')}
					</button>
				</Flex>
			</Dialog.Content>
		</Dialog.Root>
	)
}

export default RuleDetailDialog
