import React from 'react'
import { SegmentedControl } from '@radix-ui/themes'
import { useTranslation } from 'react-i18next'

export type ServerViewMode = 'list' | 'group' | 'region'

export const ServerViewModeControl: React.FC<{
	value: ServerViewMode
	onValueChange: (mode: ServerViewMode) => void
	modes?: ServerViewMode[]
	size?: '1' | '2' | '3'
}> = ({ value, onValueChange, modes = ['list', 'group', 'region'], size = '2' }) => {
	const { t } = useTranslation()

	const labels: Record<ServerViewMode, React.ReactNode> = {
		list: t('admin.nodeTable.view.list', '列表'),
		group: t('admin.nodeTable.view.group', '分组'),
		region: t('admin.nodeTable.view.region', '地域')
	}

	return (
		<SegmentedControl.Root size={size} value={value} onValueChange={v => onValueChange(v as ServerViewMode)}>
			{modes.includes('list') && <SegmentedControl.Item value="list">{labels.list}</SegmentedControl.Item>}
			{modes.includes('group') && <SegmentedControl.Item value="group">{labels.group}</SegmentedControl.Item>}
			{modes.includes('region') && <SegmentedControl.Item value="region">{labels.region}</SegmentedControl.Item>}
		</SegmentedControl.Root>
	)
}

export default ServerViewModeControl

