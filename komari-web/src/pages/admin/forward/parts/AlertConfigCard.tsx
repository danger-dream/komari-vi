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
}

const AlertConfigCard = ({ value, onChange, collapsible = false, defaultOpen = true }: Props) => {
	const { t } = useTranslation()
	const [open, setOpen] = useState(defaultOpen)

	const update = (patch: Partial<AlertConfig>) => onChange({ ...value, ...patch })
	const visible = collapsible ? open : true

	return (
		<Card>
			<Flex justify="between" align="center" mb="2">
				<Text weight="bold">{t('forward.alertConfig')}</Text>
				<Flex align="center" gap="2">
					<Text size="2">{t('forward.enable')}</Text>
					<Switch checked={value.enabled} onCheckedChange={v => update({ enabled: Boolean(v) })} />
					{collapsible && (
						<Button variant="ghost" size="1" onClick={() => setOpen(prev => !prev)}>
							<ChevronDownIcon className={visible ? 'rotate-180 transition-transform' : 'transition-transform'} />
						</Button>
					)}
				</Flex>
			</Flex>
			{visible && (
				<div className="space-y-2">
					<ToggleRow
						label={t('forward.alertNodeDown')}
						checked={value.node_down_enabled}
						onChange={v => update({ node_down_enabled: v })}
						disabled={!value.enabled}
					/>
					<ToggleRow
						label={t('forward.alertLinkDegraded')}
						checked={value.link_degraded_enabled}
						onChange={v => update({ link_degraded_enabled: v })}
						disabled={!value.enabled}
					/>
					<ToggleRow
						label={t('forward.alertLinkFaulty')}
						checked={value.link_faulty_enabled}
						onChange={v => update({ link_faulty_enabled: v })}
						disabled={!value.enabled}
					/>
					<ToggleRow
						label={t('forward.alertHighLatency')}
						checked={value.high_latency_enabled}
						onChange={v => update({ high_latency_enabled: v })}
						disabled={!value.enabled}
						extra={
							<TextField.Root
								type="number"
								value={value.high_latency_threshold}
								onChange={e => update({ high_latency_threshold: Number(e.target.value) || 0 })}
								disabled={!value.enabled || !value.high_latency_enabled}
							/>
						}
					/>
					<ToggleRow
						label={t('forward.alertTrafficSpike')}
						checked={value.traffic_spike_enabled}
						onChange={v => update({ traffic_spike_enabled: v })}
						disabled={!value.enabled}
						extra={
							<TextField.Root
								type="number"
								value={value.traffic_spike_threshold}
								onChange={e => update({ traffic_spike_threshold: Number(e.target.value) || 0 })}
								disabled={!value.enabled || !value.traffic_spike_enabled}
							/>
						}
					/>
				</div>
			)}
		</Card>
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
	<Flex align="center" gap="2">
		<Switch checked={checked} onCheckedChange={v => onChange(Boolean(v))} disabled={disabled} />
		<Text size="2" color={disabled ? 'gray' : undefined} style={{ flex: 1 }}>
			{label}
		</Text>
		{extra}
	</Flex>
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
