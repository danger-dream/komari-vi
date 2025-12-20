import { updateSettingsWithToast, useSettings } from '@/lib/api'
import { Button, Card, Dialog, Flex, IconButton, Text, TextField } from '@radix-ui/themes'
import { Pencil, Plus, Star, Trash2 } from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

type ConnectionAddress = {
	id: string
	name: string
	url: string
	is_default: boolean
}

function safeParseList(raw: any): ConnectionAddress[] {
	if (typeof raw !== 'string' || !raw.trim()) return []
	try {
		const data = JSON.parse(raw)
		if (!Array.isArray(data)) return []
		return data
			.map((it: any) => ({
				id: String(it?.id || ''),
				name: String(it?.name || ''),
				url: String(it?.url || ''),
				is_default: Boolean(it?.is_default)
			}))
			.filter((it: ConnectionAddress) => it.id && it.name && it.url)
	} catch {
		return []
	}
}

function normalizeUrl(input: string) {
	const s = (input || '').trim()
	if (!s) return ''
	if (s.startsWith('http://') || s.startsWith('https://')) return s.replace(/\/+$/, '')
	return `https://${s}`.replace(/\/+$/, '')
}

function makeId() {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function ConnectionAddressManager() {
	const { t } = useTranslation()
	const { settings, refetch } = useSettings()
	const [items, setItems] = React.useState<ConnectionAddress[]>([])
	const [dialogOpen, setDialogOpen] = React.useState(false)
	const [editingItem, setEditingItem] = React.useState<ConnectionAddress | null>(null)
	const [formName, setFormName] = React.useState('')
	const [formUrl, setFormUrl] = React.useState('')
	const [saving, setSaving] = React.useState(false)

	React.useEffect(() => {
		const list = safeParseList(settings.connection_addresses)
		if (list.length === 0 && typeof window !== 'undefined') {
			setItems([{
				id: 'current',
				name: t('server.connection_address.default_name', '主站'),
				url: window.location.origin.replace(/\/+$/, ''),
				is_default: true
			}])
			return
		}
		const hasDefault = list.some(it => it.is_default)
		setItems(hasDefault ? list : list.map((it, idx) => ({ ...it, is_default: idx === 0 })))
	}, [settings.connection_addresses, t])

	const save = async (newItems: ConnectionAddress[]) => {
		const normalized = newItems
			.map(it => ({ ...it, name: it.name.trim(), url: normalizeUrl(it.url) }))
			.filter(it => it.id && it.name && it.url)

		if (normalized.length === 0) {
			toast.error(t('server.connection_address.empty', '请至少保留一个连接地址'))
			return false
		}
		if (!normalized.some(it => it.is_default)) normalized[0].is_default = true

		setSaving(true)
		try {
			await updateSettingsWithToast({ connection_addresses: JSON.stringify(normalized) } as any, t as any)
			await refetch()
			return true
		} finally {
			setSaving(false)
		}
	}

	const openAdd = () => {
		setEditingItem(null)
		setFormName('')
		setFormUrl('')
		setDialogOpen(true)
	}

	const openEdit = (item: ConnectionAddress) => {
		setEditingItem(item)
		setFormName(item.name)
		setFormUrl(item.url)
		setDialogOpen(true)
	}

	const handleSubmit = async () => {
		const name = formName.trim()
		const url = normalizeUrl(formUrl)
		if (!name) return toast.error(t('credential.name_required', '请填写名称'))
		if (!url) return toast.error(t('server.connection_address.url_required', '请填写地址'))

		let newItems: ConnectionAddress[]
		if (editingItem) {
			newItems = items.map(it => it.id === editingItem.id ? { ...it, name, url } : it)
		} else {
			newItems = [...items, { id: makeId(), name, url, is_default: items.length === 0 }]
		}

		if (await save(newItems)) {
			setDialogOpen(false)
		}
	}

	const setDefault = async (id: string) => {
		const newItems = items.map(x => ({ ...x, is_default: x.id === id }))
		setItems(newItems)
		await save(newItems)
	}

	const removeItem = async (id: string) => {
		const newItems = items.filter(x => x.id !== id)
		if (newItems.length && !newItems.some(x => x.is_default)) {
			newItems[0].is_default = true
		}
		setItems(newItems)
		await save(newItems)
	}

	return (
		<Card>
			<Flex justify="between" align="center" gap="3" className="mb-3">
				<div>
					<Text size="5" weight="bold">{t('server.connection_address.title', '连接地址')}</Text>
					<Text size="2" color="gray" className="block mt-1">
						{t('server.connection_address.hint', '用于一键部署/SSH 自动安装时选择更快的访问地址')}
					</Text>
				</div>
				<Button size="2" onClick={openAdd}>
					<Plus size={14} />
					{t('common.add', '添加')}
				</Button>
			</Flex>

			{/* 地址列表 */}
			<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
				{items.map(it => (
					<div
						key={it.id}
						className={`px-3 py-2 rounded-lg ${
							it.is_default ? 'bg-[var(--accent-3)]' : 'bg-[var(--gray-a2)]'
						}`}>
						<Flex align="center" justify="between" gap="2">
							<Flex align="center" gap="2" className="min-w-0">
								<button
									type="button"
									onClick={() => !it.is_default && setDefault(it.id)}
									disabled={it.is_default || saving}
									className={`shrink-0 p-1 rounded transition-colors ${
										it.is_default
											? 'text-[var(--accent-11)] cursor-default'
											: 'text-[var(--gray-8)] hover:text-[var(--accent-11)] cursor-pointer'
									}`}
									title={it.is_default ? t('common.default', '默认') as string : t('common.set_default', '设为默认') as string}>
									<Star size={14} className={it.is_default ? 'fill-current' : ''} />
								</button>
								<Text size="2" weight="medium" className="truncate">{it.name}</Text>
							</Flex>
							<Flex gap="2" className="shrink-0">
								<IconButton size="1" variant="ghost" onClick={() => openEdit(it)} title={t('common.edit', '编辑') as string}>
									<Pencil size={14} />
								</IconButton>
								<IconButton
									size="1"
									variant="ghost"
									color="red"
									onClick={() => removeItem(it.id)}
									disabled={saving || items.length <= 1}
									title={t('common.delete', '删除') as string}>
									<Trash2 size={14} />
								</IconButton>
							</Flex>
						</Flex>
						<Text size="1" color="gray" className="block truncate font-mono mt-1 pl-7">{it.url}</Text>
					</div>
				))}
			</div>

			{/* 添加/编辑弹窗 */}
			<Dialog.Root open={dialogOpen} onOpenChange={setDialogOpen}>
				<Dialog.Content style={{ maxWidth: 400 }}>
					<Dialog.Title>
						{editingItem ? t('server.connection_address.edit', '编辑连接地址') : t('server.connection_address.add', '添加连接地址')}
					</Dialog.Title>
					<div className="flex flex-col gap-3 mt-3">
						<label>
							<Text size="2" weight="medium" className="block mb-1">
								{t('common.name', '名称')} <Text color="red">*</Text>
							</Text>
							<TextField.Root
								value={formName}
								onChange={e => setFormName(e.target.value)}
								placeholder={t('server.connection_address.name_placeholder', '例如：美国节点') as string}
							/>
						</label>
						<label>
							<Text size="2" weight="medium" className="block mb-1">
								{t('server.connection_address.url', '地址')} <Text color="red">*</Text>
							</Text>
							<TextField.Root
								value={formUrl}
								onChange={e => setFormUrl(e.target.value)}
								placeholder="https://us.example.com"
							/>
						</label>
					</div>
					<Flex gap="2" justify="end" className="mt-4">
						<Dialog.Close>
							<Button variant="soft" color="gray" disabled={saving}>{t('common.cancel', '取消')}</Button>
						</Dialog.Close>
						<Button onClick={handleSubmit} disabled={saving}>
							{saving ? t('common.saving', '保存中...') : t('common.save', '保存')}
						</Button>
					</Flex>
				</Dialog.Content>
			</Dialog.Root>
		</Card>
	)
}
