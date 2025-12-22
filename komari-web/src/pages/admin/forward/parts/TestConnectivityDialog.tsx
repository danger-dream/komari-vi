import { useEffect, useMemo, useState } from 'react'
import { Dialog, Button, Flex, Text } from '@radix-ui/themes'
import { CheckIcon, Cross2Icon, DotFilledIcon, ReloadIcon } from '@radix-ui/react-icons'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useNodeDetails } from '@/contexts/NodeDetailsContext'

type ConnectivityStep = {
	step: string
	node_id: string
	target: string
	success: boolean
	latency_ms?: number
	message?: string
}

type Props = {
	open: boolean
	ruleId?: number
	configJson?: string
	onClose: () => void
}

const TestConnectivityDialog = ({ open, ruleId, configJson, onClose }: Props) => {
	const { t } = useTranslation()
	const { nodeDetail } = useNodeDetails()
	const [loading, setLoading] = useState(false)
	const [steps, setSteps] = useState<ConnectivityStep[]>([])

	const nodeName = (id: string) => nodeDetail.find(n => n.uuid === id)?.name || id

	const payload = useMemo(() => {
		if (configJson) return { config_json: configJson }
		if (ruleId) return { rule_id: ruleId }
		return null
	}, [configJson, ruleId])

	const runTest = async () => {
		if (!payload) return
		setLoading(true)
		try {
			const res = await fetch('/api/v1/forwards/test-connectivity', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			})
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			const body = await res.json()
			setSteps(body.data?.steps || [])
		} catch (e: any) {
			toast.error(e?.message || 'Test failed')
		} finally {
			setLoading(false)
		}
	}

	useEffect(() => {
		if (open) runTest()
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open])

	const statusIcon = (success: boolean | undefined) => {
		if (success === true) return <CheckIcon className="text-green-600" />
		if (success === false) return <Cross2Icon className="text-red-600" />
		return <DotFilledIcon className="text-gray-400" />
	}

	const stepLabel = (step: string) => {
		switch (step) {
			case 'entry_reach':
				return t('forward.testEntry', { defaultValue: '入口节点可达' })
			case 'relay_reach':
				return t('forward.testRelay', { defaultValue: '中继节点可达' })
			case 'hop_reach':
				return t('forward.testHop', { defaultValue: '跳节点可达' })
			case 'target_reach':
				return t('forward.testTarget', { defaultValue: '目标可达' })
			case 'end_to_end':
				return t('forward.testEndToEnd', { defaultValue: '端到端连通性' })
			default:
				return step
		}
	}

	return (
		<Dialog.Root open={open} onOpenChange={o => (!o ? onClose() : null)}>
			<Dialog.Content maxWidth="620px">
				<Dialog.Title>{t('forward.testConnectivity')}</Dialog.Title>
				<Flex justify="between" align="center" mb="3">
					<Text size="2" color="gray">
						{t('forward.testConnectivityHint', { defaultValue: '按步骤检测链路连通性' })}
					</Text>
					<Button variant="ghost" onClick={runTest} disabled={loading}>
						<ReloadIcon /> {t('forward.retry', { defaultValue: '重新测试' })}
					</Button>
				</Flex>
				<div className="space-y-2">
					{steps.length === 0 ? (
						<Text size="2" color="gray">
							{loading ? t('common.loading') : t('forward.noData', { defaultValue: '暂无结果' })}
						</Text>
					) : (
						steps.map((s, idx) => (
							<div key={`${s.step}-${idx}`} className="flex items-start gap-2 rounded-md border border-(--gray-4) p-2">
								<div className="mt-0.5">{statusIcon(s.success)}</div>
								<div className="flex-1">
									<Text weight="bold">{stepLabel(s.step)}</Text>
									<Text size="1" color="gray">
										{nodeName(s.node_id)} → {s.target}
									</Text>
									{s.latency_ms !== undefined && (
										<Text size="1" color="gray">
											{t('forward.latency')}: {s.latency_ms}ms
										</Text>
									)}
									{s.message && (
										<Text size="1" color="gray">
											{s.message}
										</Text>
									)}
								</div>
							</div>
						))
					)}
				</div>
				<Flex justify="end" mt="3">
					<Button variant="soft" onClick={onClose}>
						{t('common.close')}
					</Button>
				</Flex>
			</Dialog.Content>
		</Dialog.Root>
	)
}

export default TestConnectivityDialog
