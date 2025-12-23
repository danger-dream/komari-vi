import { Button, Card, Flex, Switch, Text, TextField } from '@radix-ui/themes'
import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import { ChevronDownIcon } from '@radix-ui/react-icons'

export type AlertConfig = {
	enabled: boolean
	node_down_enabled: boolean
	link_degraded_enabled: boolean
	link_faulty_enabled: boolean
	high_latency_enabled: boolean
	high_latency_threshold: number
	traffic_spike_enabled: boolean
	traffic_spike_threshold: number
}

type Props = {
	value: AlertConfig
	onChange: (cfg: AlertConfig) => void
	collapsible?: boolean
	defaultOpen?: boolean
	variant?: 'card' | 'embedded'
	hideEnableSwitch?: boolean
}

const AlertConfigCard = ({ value, onChange, collapsible = false, defaultOpen = true, variant = 'card', hideEnableSwitch = false }: Props) => {
	const { t } = useTranslation()
	const [open, setOpen] = useState(defaultOpen)

	const update = (patch: Partial<AlertConfig>) => onChange({ ...value, ...patch })
	const visible = collapsible ? open : true
	const Wrapper: any = variant === 'card' ? Card : 'div'
	const showHeader = variant === 'card' || (!hideEnableSwitch || collapsible)

	return (
		<Wrapper className={variant === 'embedded' ? 'space-y-2' : undefined}>
			{showHeader && (
				<Flex justify={variant === 'embedded' ? 'end' : 'between'} align="center" mb="2">
					{variant === 'card' && <Text weight="bold">{t('forward.alertConfig', { defaultValue: '告警配置' })}</Text>}
					<Flex align="center" gap="2">
						{!hideEnableSwitch && (
							<>
								<Text size="2">{t('forward.enable', { defaultValue: '启用' })}</Text>
								<Switch checked={value.enabled} onCheckedChange={v => update({ enabled: Boolean(v) })} />
							</>
						)}
						{collapsible && (
							<Button variant="ghost" size="1" onClick={() => setOpen(prev => !prev)}>
								<ChevronDownIcon className={visible ? 'rotate-180 transition-transform' : 'transition-transform'} />
							</Button>
						)}
					</Flex>
				</Flex>
			)}
			{visible && (
				<div className="space-y-2">
					<ToggleRow
						label={t('forward.alertNodeDown', { defaultValue: '节点离线' })}
						checked={value.node_down_enabled}
						onChange={v => update({ node_down_enabled: v })}
						disabled={!value.enabled}
					/>
					<ToggleRow
						label={t('forward.alertLinkDegraded', { defaultValue: '链路退化' })}
						checked={value.link_degraded_enabled}
						onChange={v => update({ link_degraded_enabled: v })}
						disabled={!value.enabled}
					/>
					<ToggleRow
						label={t('forward.alertLinkFaulty', { defaultValue: '链路故障' })}
						checked={value.link_faulty_enabled}
						onChange={v => update({ link_faulty_enabled: v })}
						disabled={!value.enabled}
					/>
					<ToggleRow
						label={t('forward.alertHighLatency', { defaultValue: '高延迟' })}
						checked={value.high_latency_enabled}
						onChange={v => update({ high_latency_enabled: v })}
						disabled={!value.enabled}
						extra={
							<TextField.Root
								size="1"
								type="number"
								value={value.high_latency_threshold}
								onChange={e => update({ high_latency_threshold: Number(e.target.value) || 0 })}
								disabled={!value.enabled || !value.high_latency_enabled}
							/>
						}
					/>
					<ToggleRow
						label={t('forward.alertTrafficSpike', { defaultValue: '流量突增' })}
						checked={value.traffic_spike_enabled}
						onChange={v => update({ traffic_spike_enabled: v })}
						disabled={!value.enabled}
						extra={
							<TextField.Root
								size="1"
								type="number"
								value={value.traffic_spike_threshold}
								onChange={e => update({ traffic_spike_threshold: Number(e.target.value) || 0 })}
								disabled={!value.enabled || !value.traffic_spike_enabled}
							/>
						}
					/>
				</div>
			)}
		</Wrapper>
	)
}

const ToggleRow = ({
	label,
	checked,
	onChange,
	disabled,
	extra
}: {
	label: string
	checked: boolean
	onChange: (v: boolean) => void
	disabled?: boolean
	extra?: React.ReactNode
}) => (
	<div className="flex flex-wrap items-center gap-3 rounded-md bg-[var(--gray-1)] px-3 py-2">
		<Switch checked={checked} onCheckedChange={v => onChange(Boolean(v))} disabled={disabled} />
		<Text size="2" color={disabled ? 'gray' : undefined} className="flex-1 min-w-[160px]">
			{label}
		</Text>
		{extra && (
			<div className="w-full sm:w-40 min-w-[140px]">
				{extra}
			</div>
		)}
	</div>
)

export const defaultAlertConfig: AlertConfig = {
	enabled: false,
	node_down_enabled: true,
	link_degraded_enabled: true,
	link_faulty_enabled: true,
	high_latency_enabled: false,
	high_latency_threshold: 200,
	traffic_spike_enabled: false,
	traffic_spike_threshold: 2
}

export default AlertConfigCard
