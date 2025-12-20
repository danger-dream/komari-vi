import NodeSelectorDialog from '@/components/NodeSelectorDialog'
import { Select, TextField } from '@radix-ui/themes'
import React from 'react'
import { useTranslation } from 'react-i18next'

export type SPTaskFormState = {
	name: string
	type: 'icmp' | 'tcp' | 'http'
	target: string
	clients: string[]
	step: number
	pings: number
	timeout_ms: number
	payload_size: number
}

const normalize = (value: number | undefined, fallback: number) => (typeof value === 'number' && value > 0 ? value : fallback)

export const buildDefaultSPTaskForm = (preset?: Partial<SPTaskFormState>): SPTaskFormState => ({
	name: preset?.name ?? '',
	type: preset?.type ?? 'icmp',
	target: preset?.target ?? '',
	clients: preset?.clients ?? [],
	step: normalize(preset?.step, 30),
	pings: normalize(preset?.pings, 20),
	timeout_ms: normalize(preset?.timeout_ms, 1000),
	payload_size: normalize(preset?.payload_size, 56)
})

export const SPTaskFormFields: React.FC<{
	form: SPTaskFormState
	onChange: (patch: Partial<SPTaskFormState>) => void
	nameField?: React.ReactNode
	targetField?: React.ReactNode
}> = ({ form, onChange, nameField, targetField }) => {
	const { t } = useTranslation()
	return (
		<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
			{nameField ? (
				nameField
			) : (
				<label className="flex flex-col gap-1 sm:col-span-2">
					<span className="text-sm font-medium text-(--gray-12)">{t('common.name')}</span>
					<TextField.Root
						name="name"
						id="sp_name"
						autoComplete="off"
						value={form.name}
						onChange={ev => onChange({ name: ev.currentTarget.value })}
						required
					/>
				</label>
			)}
			<label className="flex flex-col gap-1">
				<span className="text-sm font-medium text-(--gray-12)">{t('spPing.type')}</span>
				<Select.Root value={form.type} onValueChange={v => onChange({ type: v as any })} name="type" required>
					<Select.Trigger className="w-full" />
					<Select.Content>
						<Select.Item value="icmp">ICMP</Select.Item>
						<Select.Item value="tcp">TCP</Select.Item>
						<Select.Item value="http">HTTP</Select.Item>
					</Select.Content>
				</Select.Root>
			</label>
			{targetField ? (
				targetField
			) : (
				<label className="flex flex-col gap-1">
					<span className="text-sm font-medium text-(--gray-12)">{t('spPing.target')}</span>
					<TextField.Root
						name="target"
						id="sp_target"
						autoComplete="off"
						placeholder="1.1.1.1 | 1.1.1.1:80 | https://1.1.1.1"
						value={form.target}
						onChange={ev => onChange({ target: ev.currentTarget.value })}
						required
					/>
				</label>
			)}
			<label className="flex flex-col gap-1">
				<span className="text-sm font-medium text-(--gray-12)">{t('spPing.step')} (s)</span>
				<TextField.Root
					name="step"
					type="number"
					min={10}
					value={form.step}
					onChange={ev => onChange({ step: parseInt(ev.currentTarget.value || '0', 10) || 0 })}
					required
				/>
			</label>
			<label className="flex flex-col gap-1">
				<span className="text-sm font-medium text-(--gray-12)">{t('spPing.pings')}</span>
				<TextField.Root
					name="pings"
					type="number"
					min={3}
					value={form.pings}
					onChange={ev => onChange({ pings: parseInt(ev.currentTarget.value || '0', 10) || 0 })}
					required
				/>
			</label>
			<label className="flex flex-col gap-1">
				<span className="text-sm font-medium text-(--gray-12)">{t('spPing.timeout')} (ms)</span>
				<TextField.Root
					name="timeout_ms"
					type="number"
					min={500}
					value={form.timeout_ms}
					onChange={ev => onChange({ timeout_ms: parseInt(ev.currentTarget.value || '0', 10) || 0 })}
					required
				/>
			</label>
			<label className="flex flex-col gap-1">
				<span className="text-sm font-medium text-(--gray-12)">{t('spPing.payload_size')}</span>
				<TextField.Root
					name="payload_size"
					type="number"
					min={16}
					max={1500}
					value={form.payload_size}
					onChange={ev => onChange({ payload_size: parseInt(ev.currentTarget.value || '0', 10) || 0 })}
					required
				/>
			</label>
			<div className="flex flex-col gap-1 sm:col-span-2">
				<span className="text-sm font-medium text-(--gray-12)">{t('common.server')}</span>
				<div className="flex items-center gap-2">
					<NodeSelectorDialog value={form.clients} onChange={v => onChange({ clients: v })} showViewModeToggle />
					<span className="text-sm text-(--gray-11)">{t('common.selected', { count: form.clients.length })}</span>
				</div>
			</div>
		</div>
	)
}
