import Loading from '@/components/loading'
import { NodeDetailsProvider } from '@/contexts/NodeDetailsContext'
import { SPPingTaskProvider, useSPPingTask } from '@/contexts/SPPingTaskContext'
import { Box, Flex, Tabs, Button, Checkbox, Text } from '@radix-ui/themes'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { TaskView } from './spPingTask_Task'
import { ServerView } from './spPingTask_Server'
import { AddButton } from './spPingTask_disk'

const SpPingTaskPage = () => (
	<SPPingTaskProvider>
		<NodeDetailsProvider>
			<Inner />
		</NodeDetailsProvider>
	</SPPingTaskProvider>
)

const Inner = () => {
	const { tasks, isLoading, error } = useSPPingTask()
	const { t } = useTranslation()
	const [privacyMode, setPrivacyMode] = React.useState(false)

	if (isLoading) {
		return <Loading />
	}
	if (error) {
		return <div>{error}</div>
	}

	return (
		<Flex direction="column" gap="4" className="p-4">
			<div className="flex justify-between items-center">
				<label className="text-2xl font-bold">{t('spPing.title')}</label>
				<Flex gap="2">
					<Text as="label" size="2" className="flex items-center gap-2 cursor-pointer select-none">
						<Checkbox checked={privacyMode} onCheckedChange={checked => setPrivacyMode(Boolean(checked))} />
						{t('admin.nodeTable.privacyMode', '隐私模式')}
					</Text>
					<AddButton />
					<Button
						variant="outline"
						color="red"
						onClick={() => {
							if (!confirm(t('spPing.clear_confirm', { defaultValue: '确定清空所有多样本延迟历史数据？' }))) return
							fetch('/api/admin/sp-ping/clear', { method: 'POST' })
								.then(res => {
									if (!res.ok) throw new Error(t('common.error'))
									return res.json()
								})
								.then(() => {
									toast.success(t('common.success'))
								})
								.catch(err => toast.error(err.message || t('common.error')))
						}}>
						{t('spPing.clear', { defaultValue: '清空数据' })}
					</Button>
				</Flex>
			</div>
			<Tabs.Root defaultValue="task">
				<Tabs.List>
					<Tabs.Trigger value="task">{t('ping.task_view')}</Tabs.Trigger>
					<Tabs.Trigger value="server">{t('ping.server_view')}</Tabs.Trigger>
				</Tabs.List>
				<Box pt="3">
					<Tabs.Content value="task">
						<TaskView tasks={tasks ?? []} privacyMode={privacyMode} />
					</Tabs.Content>
					<Tabs.Content value="server">
						<ServerView tasks={tasks ?? []} />
					</Tabs.Content>
				</Box>
			</Tabs.Root>
		</Flex>
	)
}

export default SpPingTaskPage
