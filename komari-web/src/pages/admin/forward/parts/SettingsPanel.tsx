import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Card, Flex, Grid, Select, Text, TextField } from '@radix-ui/themes'
import { toast } from 'sonner'

type Settings = {
	stats_report_interval: number
	health_check_interval: number
	history_aggregate_period: string
	realm_crash_restart_limit: number
	process_stop_timeout: number
}

const SettingsPanel = () => {
	const { t } = useTranslation()
	const [loading, setLoading] = useState(false)
	const [settings, setSettings] = useState<Settings>({
		stats_report_interval: 10,
		health_check_interval: 10,
		history_aggregate_period: '1hour',
		realm_crash_restart_limit: 3,
		process_stop_timeout: 5
	})

	const fetchSettings = async () => {
		setLoading(true)
		try {
			const res = await fetch('/api/v1/forwards/system-settings')
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			const body = await res.json()
			setSettings(body.data || settings)
		} catch (e: any) {
			toast.error(e?.message || 'Load failed')
		} finally {
			setLoading(false)
		}
	}

	useEffect(() => {
		fetchSettings()
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [])

	const save = async () => {
		try {
			const res = await fetch('/api/v1/forwards/system-settings', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(settings)
			})
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			toast.success(t('forward.settingsSaved'))
		} catch (e: any) {
			toast.error(e?.message || 'Save failed')
		}
	}

	const updateField = (key: keyof Settings, value: number | string) => {
		setSettings(prev => ({ ...prev, [key]: value }))
	}

	const periodOptions = [
		{ value: '10min', label: t('forward.historyPeriod10m', { defaultValue: '每10分钟' }) },
		{ value: '30min', label: t('forward.historyPeriod30m', { defaultValue: '每30分钟' }) },
		{ value: '1hour', label: t('forward.historyPeriod1h', { defaultValue: '每小时' }) },
		{ value: '1day', label: t('forward.historyPeriod1d', { defaultValue: '每天' }) }
	]

	return (
		<Card>
			<Flex justify="between" align="center" mb="3">
				<div>
					<Text weight="bold">{t('forward.systemSettings')}</Text>
					<Text size="1" color="gray">
						{t('forward.systemSettingsHint', { defaultValue: '修改后对所有规则立即生效' })}
					</Text>
				</div>
				<Button size="2" onClick={save} disabled={loading}>
					{t('forward.submit')}
				</Button>
			</Flex>
			<Grid columns="2" gap="4">
				<NumberField
					label={t('forward.statsReportInterval', { defaultValue: '统计上报间隔(秒)' })}
					help={t('forward.statsReportHint', { defaultValue: 'Agent 上报实时统计的时间间隔' })}
					min={10}
					max={300}
					value={settings.stats_report_interval}
					onChange={v => updateField('stats_report_interval', v)}
				/>
				<NumberField
					label={t('forward.healthCheckInterval', { defaultValue: '健康检查间隔(秒)' })}
					help={t('forward.healthCheckHint', { defaultValue: 'Agent 执行链路健康检查的间隔' })}
					min={5}
					max={600}
					value={settings.health_check_interval}
					onChange={v => updateField('health_check_interval', v)}
				/>
				<NumberField
					label={t('forward.crashRestartLimit', { defaultValue: '崩溃自动重启次数' })}
					help={t('forward.crashRestartHint', { defaultValue: '超过次数将停止重启并告警' })}
					min={1}
					max={10}
					value={settings.realm_crash_restart_limit}
					onChange={v => updateField('realm_crash_restart_limit', v)}
				/>
				<NumberField
					label={t('forward.processStopTimeout', { defaultValue: '进程停止超时(秒)' })}
					help={t('forward.processStopHint', { defaultValue: 'SIGTERM 后等待进程优雅退出的时间' })}
					min={3}
					max={30}
					value={settings.process_stop_timeout}
					onChange={v => updateField('process_stop_timeout', v)}
				/>
				<div className="col-span-2 flex flex-col gap-2">
					<Text size="2">{t('forward.historyAggregatePeriod', { defaultValue: '历史数据聚合周期' })}</Text>
					<Text size="1" color="gray">
						{t('forward.historyAggregateHint', { defaultValue: '历史流量数据的聚合粒度' })}
					</Text>
					<Select.Root value={settings.history_aggregate_period} onValueChange={v => updateField('history_aggregate_period', v)}>
						<Select.Trigger />
						<Select.Content>
							{periodOptions.map(option => (
								<Select.Item key={option.value} value={option.value}>
									{option.label}
								</Select.Item>
							))}
						</Select.Content>
					</Select.Root>
				</div>
			</Grid>
		</Card>
	)
}

const NumberField = ({
	label,
	help,
	value,
	min,
	max,
	onChange
}: {
	label: string
	help: string
	value: number
	min: number
	max: number
	onChange: (v: number) => void
}) => (
	<div className="flex flex-col gap-2">
		<Text size="2">{label}</Text>
		<Text size="1" color="gray">
			{help}
		</Text>
		<TextField.Root type="number" value={value} min={min} max={max} onChange={e => onChange(Number(e.target.value))} />
	</div>
)

export default SettingsPanel
