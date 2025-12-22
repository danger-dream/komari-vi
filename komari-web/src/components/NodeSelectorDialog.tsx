import React from 'react'
import { Dialog, Button, Flex } from '@radix-ui/themes'
import NodeSelector from './NodeSelector'
import { useTranslation } from 'react-i18next'
import { type NodeDetail } from '@/contexts/NodeDetailsContext'

interface NodeSelectorDialogProps {
	open?: boolean
	onOpenChange?: (open: boolean) => void
	value: string[]
	onChange: (uuids: string[]) => void
	title?: React.ReactNode
	className?: string
	hiddenDescription?: boolean
	hiddenUuidOnlyClient?: boolean
	children?: React.ReactNode // 新增 children 属性
	showViewModeToggle?: boolean
	defaultViewMode?: 'list' | 'group' | 'region'
	enableRegion?: boolean
	disabled?: boolean
	filterNode?: (node: NodeDetail) => boolean
	excludeIds?: string[]
}

const NodeSelectorDialog: React.FC<NodeSelectorDialogProps> = ({
	open: openProp,
	onOpenChange: onOpenChangeProp,
	value,
	onChange,
	title,
	className,
	hiddenDescription,
	hiddenUuidOnlyClient,
	children, // 解构 children
	showViewModeToggle = false,
	defaultViewMode,
	enableRegion = true,
	disabled = false,
	filterNode,
	excludeIds
}) => {
	const { t } = useTranslation()
	// 自动/受控弹窗开关
	const [autoOpen, setAutoOpen] = React.useState(false)
	const open = openProp !== undefined ? openProp : autoOpen
	const onOpenChange = onOpenChangeProp || setAutoOpen
	// 临时选中，只有点击确定才提交
	const [temp, setTemp] = React.useState<string[]>(value ?? [])
	React.useEffect(() => {
		if (open) setTemp(value ?? [])
	}, [open, value])

	const handleOk = () => {
		onChange(temp)
		onOpenChange(false)
	}

	const contentStyle: React.CSSProperties = {
		maxWidth: 420,
		maxHeight: '80vh',
		overflow: 'hidden'
	}

	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Trigger asChild>{children ? children : <Button disabled={disabled}>{title || t('common.select')}</Button>}</Dialog.Trigger>
			<Dialog.Content style={contentStyle}>
				<Dialog.Title>{title || t('common.select')}</Dialog.Title>
				<Flex direction="column" gap="3">
					<NodeSelector
						value={temp}
						onChange={setTemp}
						className={className}
						hiddenUuidOnlyClient={hiddenUuidOnlyClient}
						hiddenDescription={hiddenDescription}
						maxHeight="45vh"
						enableGroup
						enableRegion={enableRegion}
						ungroupedLabel={t('common.ungrouped', { defaultValue: '未分组' })}
						showViewModeToggle={showViewModeToggle}
						defaultViewMode={defaultViewMode}
						filterNode={filterNode}
						excludeIds={excludeIds}
					/>
					<Flex justify="end" gap="2">
						<Dialog.Close>
							<Button variant="soft">{t('common.cancel')}</Button>
						</Dialog.Close>
						<Button onClick={handleOk}>{t('common.done')}</Button>
					</Flex>
				</Flex>
			</Dialog.Content>
		</Dialog.Root>
	)
}

export default NodeSelectorDialog
