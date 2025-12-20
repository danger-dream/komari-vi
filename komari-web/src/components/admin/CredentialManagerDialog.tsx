import * as React from 'react'
import { Badge, Button, Card, Dialog, Flex, IconButton, Text, TextArea, TextField } from '@radix-ui/themes'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Copy, Key, KeyRound, Pencil, Plus, Trash2 } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

type CredentialType = 'password' | 'key'

type Credential = {
	id: number
	name: string
	username: string
	type: CredentialType
	remark: string
	created_at: string
	updated_at: string
}

async function extractError(resp: Response) {
	try {
		const data = await resp.json()
		return data?.message || data?.error || resp.statusText
	} catch {
		return resp.statusText
	}
}

type UpsertMode = 'create' | 'edit'

function CredentialUpsertDialog({
	mode,
	open,
	onOpenChange,
	initial,
	onSaved
}: {
	mode: UpsertMode
	open: boolean
	onOpenChange: (open: boolean) => void
	initial?: Partial<Credential> & { secret?: string; passphrase?: string; clearPassphrase?: boolean }
	onSaved?: () => void
}) {
	const { t } = useTranslation()
	const [saving, setSaving] = React.useState(false)
	const originalTypeRef = React.useRef<CredentialType>(initial?.type === 'key' ? 'key' : 'password')

	const [form, setForm] = React.useState({
		id: initial?.id ?? 0,
		name: initial?.name ?? '',
		username: initial?.username ?? 'root',
		type: (initial?.type === 'key' ? 'key' : 'password') as CredentialType,
		secret: initial?.secret ?? '',
		passphrase: initial?.passphrase ?? '',
		clearPassphrase: Boolean(initial?.clearPassphrase),
		remark: initial?.remark ?? ''
	})

	React.useEffect(() => {
		if (!open) return
		originalTypeRef.current = initial?.type === 'key' ? 'key' : 'password'
		setForm({
			id: initial?.id ?? 0,
			name: initial?.name ?? '',
			username: initial?.username ?? 'root',
			type: (initial?.type === 'key' ? 'key' : 'password') as CredentialType,
			secret: initial?.secret ?? '',
			passphrase: initial?.passphrase ?? '',
			clearPassphrase: Boolean(initial?.clearPassphrase),
			remark: initial?.remark ?? ''
		})
	}, [open, initial])

	const submit = async () => {
		if (!form.name.trim()) return toast.error(t('credential.name_required', '请填写名称'))
		if (!form.username.trim()) return toast.error(t('credential.username_required', '请填写用户'))

		if (mode === 'create') {
			if (!form.secret.trim()) return toast.error(t('credential.secret_required', '请填写密码/私钥'))
		} else {
			const originalType = originalTypeRef.current
			const typeChanged = originalType !== form.type
			if (typeChanged && !form.secret.trim()) {
				return toast.error(t('credential.secret_required', '切换类型后请填写新的密码/私钥'))
			}
		}

		setSaving(true)
		try {
			if (mode === 'create') {
				const resp = await fetch('/api/admin/credential', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						name: form.name,
						username: form.username,
						type: form.type,
						secret: form.secret,
						passphrase: form.type === 'key' ? form.passphrase : '',
						remark: form.remark
					})
				})
				if (!resp.ok) throw new Error(await extractError(resp))
				toast.success(t('credential.created', '已创建'))
			} else {
				const payload: any = {
					name: form.name,
					username: form.username,
					type: form.type,
					remark: form.remark
				}
				if (form.secret.trim()) payload.secret = form.secret
				if (form.type === 'key') {
					if (form.clearPassphrase) payload.passphrase = ''
					else if (form.passphrase.trim()) payload.passphrase = form.passphrase
				}
				const resp = await fetch(`/api/admin/credential/${form.id}`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(payload)
				})
				if (!resp.ok) throw new Error(await extractError(resp))
				toast.success(t('credential.saved', '已保存'))
			}

			onSaved?.()
			onOpenChange(false)
		} catch (e: any) {
			toast.error(t(mode === 'create' ? 'credential.create_failed' : 'credential.save_failed', '操作失败') + ': ' + (e?.message || e))
		} finally {
			setSaving(false)
		}
	}

	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Content style={{ maxWidth: 600 }}>
				<Dialog.Title>{mode === 'create' ? t('credential.create', '新增凭据') : t('common.edit', '编辑凭据')}</Dialog.Title>
				<Dialog.Description>{t('credential.hint', '用于 SSH 自动安装（建议使用 root）。密码/私钥与 passphrase 会加密存储。')}</Dialog.Description>

				<div className="mt-3 flex flex-col gap-3">
					<label>
						<Text size="2" weight="medium">
							{t('common.name', '名称')} <Text color="red">*</Text>
						</Text>
						<TextField.Root
							value={form.name}
							onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
							placeholder="prod-root"
							autoComplete="off"
						/>
					</label>
					<label>
						<Text size="2" weight="medium">
							{t('credential.username', '用户')} <Text color="red">*</Text>
						</Text>
						<TextField.Root
							value={form.username}
							onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
							placeholder="root"
							autoComplete="off"
						/>
					</label>

					<div>
						<Text size="2" weight="medium" className="block mb-1">
							{t('credential.type', '类型')}
						</Text>
						<Flex gap="4" align="center" wrap="wrap">
							<label className="flex items-center gap-2 cursor-pointer">
								<input type="radio" checked={form.type === 'password'} onChange={() => setForm(f => ({ ...f, type: 'password' }))} />
								<Text size="2">{t('credential.type_password', '密码')}</Text>
							</label>
							<label className="flex items-center gap-2 cursor-pointer">
								<input type="radio" checked={form.type === 'key'} onChange={() => setForm(f => ({ ...f, type: 'key' }))} />
								<Text size="2">{t('credential.type_key', '密钥')}</Text>
							</label>
						</Flex>
					</div>

					<label>
						<Text size="2" weight="medium">
							{mode === 'edit'
								? t('credential.secret_optional', '新密码/私钥（留空不变）')
								: form.type === 'key'
									? t('credential.private_key', '私钥')
									: t('credential.password', '密码')}
							{mode === 'create' && <Text color="red"> *</Text>}
						</Text>
						{form.type === 'key' ? (
							<TextArea
								value={form.secret}
								onChange={e => setForm(f => ({ ...f, secret: e.target.value }))}
								style={{ minHeight: 120, fontFamily: 'monospace' }}
								autoComplete="off"
								placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
							/>
						) : (
							<TextField.Root
								type="password"
								value={form.secret}
								onChange={e => setForm(f => ({ ...f, secret: e.target.value }))}
								autoComplete="new-password"
								placeholder={mode === 'edit' ? t('credential.password_placeholder_edit', '留空则不修改') as string : ''}
							/>
						)}
					</label>

					{form.type === 'key' && (
						<>
							<label>
								<Text size="2" weight="medium">
									{mode === 'edit' ? t('credential.passphrase_optional', 'Passphrase（留空不变）') : t('credential.passphrase', 'Passphrase（可选）')}
								</Text>
								<TextField.Root
									type="password"
									value={form.passphrase}
									onChange={e => setForm(f => ({ ...f, passphrase: e.target.value, clearPassphrase: false }))}
									autoComplete="new-password"
								/>
							</label>
							{mode === 'edit' && (
								<label className="flex items-center gap-2 cursor-pointer select-none">
									<input type="checkbox" checked={form.clearPassphrase} onChange={e => setForm(f => ({ ...f, clearPassphrase: e.target.checked }))} />
									<Text size="2">{t('credential.clear_passphrase', '清空 passphrase')}</Text>
								</label>
							)}
						</>
					)}

					<label>
						<Text size="2" weight="medium">
							{t('common.remark', '备注')}
						</Text>
						<TextField.Root
							value={form.remark}
							onChange={e => setForm(f => ({ ...f, remark: e.target.value }))}
							autoComplete="off"
						/>
					</label>
				</div>

				<Flex justify="end" gap="2" className="mt-4">
					<Dialog.Close>
						<Button variant="soft" color="gray" disabled={saving}>
							{t('common.cancel', '取消')}
						</Button>
					</Dialog.Close>
					<Button onClick={submit} disabled={saving}>
						{saving ? t('common.saving', '保存中...') : t('common.save', '保存')}
					</Button>
				</Flex>
			</Dialog.Content>
		</Dialog.Root>
	)
}

export function CredentialCreateDialog({
	onSaved,
	trigger,
	defaultUsername
}: {
	onSaved?: () => void
	trigger?: React.ReactNode
	defaultUsername?: string
}) {
	const { t } = useTranslation()
	const [open, setOpen] = React.useState(false)
	const triggerNode = React.useMemo(() => {
		if (React.isValidElement(trigger)) {
			const existingOnClick = (trigger.props as any)?.onClick as ((e: any) => void) | undefined
			return React.cloneElement(trigger as any, {
				onClick: (e: any) => {
					existingOnClick?.(e)
					setOpen(true)
				}
			})
		}
		return (
			<Button size="1" variant="soft" onClick={() => setOpen(true)}>
				<Plus size={14} />
				{t('credential.create', '新增')}
			</Button>
		)
	}, [t, trigger])
	return (
		<>
			{triggerNode}
			<CredentialUpsertDialog
				mode="create"
				open={open}
				onOpenChange={setOpen}
				initial={{ username: defaultUsername ?? 'root' }}
				onSaved={onSaved}
			/>
		</>
	)
}

export function CredentialManagerPanel({ onChange }: { onChange?: () => void }) {
	const { t } = useTranslation()
	const [items, setItems] = React.useState<Credential[]>([])
	const [loading, setLoading] = React.useState(false)
	const [upsertOpen, setUpsertOpen] = React.useState(false)
	const [upsertMode, setUpsertMode] = React.useState<UpsertMode>('create')
	const [upsertInitial, setUpsertInitial] = React.useState<any>({})
	const [deleteTarget, setDeleteTarget] = React.useState<Credential | null>(null)
	const [deleting, setDeleting] = React.useState(false)

	const fetchList = React.useCallback(async () => {
		setLoading(true)
		try {
			const resp = await fetch('/api/admin/credential')
			if (!resp.ok) throw new Error(await extractError(resp))
			const data = await resp.json()
			setItems(data?.data ?? [])
		} catch (e: any) {
			toast.error(t('credential.fetch_failed', '获取凭据失败') + ': ' + (e?.message || e))
		} finally {
			setLoading(false)
		}
	}, [t])

	React.useEffect(() => {
		fetchList()
	}, [fetchList])

	const revealAndCopy = async (id: number, what: 'secret' | 'passphrase') => {
		try {
			const resp = await fetch(`/api/admin/credential/${id}/reveal`)
			if (!resp.ok) throw new Error(await extractError(resp))
			const data = await resp.json()
			const secret = data?.data?.secret ?? ''
			const passphrase = data?.data?.passphrase ?? ''
			const val = what === 'secret' ? secret : passphrase
			if (!val) {
				toast.error(what === 'secret' ? t('credential.secret_empty', '没有可复制的密码/私钥') : t('credential.passphrase_empty', '该凭据没有 passphrase'))
				return
			}
			await navigator.clipboard.writeText(val)
			toast.success(what === 'secret' ? t('credential.secret_copied', '已复制密码/私钥') : t('credential.passphrase_copied', '已复制 passphrase'))
		} catch (e: any) {
			toast.error(t('credential.reveal_failed', '获取/复制失败') + ': ' + (e?.message || e))
		}
	}

	const remove = async (id: number) => {
		setDeleting(true)
		try {
			const resp = await fetch(`/api/admin/credential/${id}`, { method: 'DELETE' })
			if (!resp.ok) throw new Error(await extractError(resp))
			toast.success(t('credential.deleted', '已删除'))
			setDeleteTarget(null)
			await fetchList()
			onChange?.()
		} catch (e: any) {
			toast.error(t('credential.delete_failed', '删除失败') + ': ' + (e?.message || e))
		} finally {
			setDeleting(false)
		}
	}

	return (
		<Card>
			<Flex justify="between" align="center" gap="3" wrap="wrap">
				<div>
					<Text size="5" weight="bold">
						{t('credential.manage', '凭据')}
					</Text>
					<Text size="2" color="gray" className="block mt-1">
						{t('credential.hint', '用于 SSH 自动安装（建议使用 root）。密码/私钥与 passphrase 会加密存储。')}
					</Text>
				</div>
				<Flex gap="2" align="center">
					<Button variant="soft" onClick={fetchList} disabled={loading}>
						{t('common.refresh', '刷新')}
					</Button>
					<Button
						onClick={() => {
							setUpsertMode('create')
							setUpsertInitial({ username: 'root', type: 'password' })
							setUpsertOpen(true)
						}}>
						<Plus size={16} />
						{t('credential.create', '新增')}
					</Button>
				</Flex>
			</Flex>

			<div className="mt-3 overflow-hidden rounded-md border border-[var(--gray-a6)]">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="min-w-[160px]">{t('common.name', '名称')}</TableHead>
							<TableHead className="min-w-[120px]">{t('credential.username', '用户')}</TableHead>
							<TableHead className="min-w-[120px]">{t('credential.type', '类型')}</TableHead>
							<TableHead>{t('common.remark', '备注')}</TableHead>
							<TableHead className="text-right min-w-[220px]">{t('common.action', '操作')}</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{items.length === 0 ? (
							<TableRow>
								<TableCell colSpan={5} className="text-center text-[var(--accent-11)]">
									{loading ? t('loading', '加载中...') : t('credential.empty', '暂无凭据')}
								</TableCell>
							</TableRow>
						) : (
							items.map(it => (
								<TableRow key={it.id}>
									<TableCell>
										<Text weight="bold">{it.name}</Text>
									</TableCell>
									<TableCell>{it.username}</TableCell>
									<TableCell>
										<Badge variant="soft" color={it.type === 'key' ? 'blue' : 'gray'}>
											{it.type === 'key' ? (
												<Flex gap="1" align="center">
													<Key size={12} />
													{t('credential.type_key', '密钥')}
												</Flex>
											) : (
												<Flex gap="1" align="center">
													<KeyRound size={12} />
													{t('credential.type_password', '密码')}
												</Flex>
											)}
										</Badge>
									</TableCell>
									<TableCell className="max-w-[260px] truncate">{it.remark || '-'}</TableCell>
									<TableCell>
										<Flex justify="end" gap="2">
											<IconButton
												variant="soft"
												onClick={() => revealAndCopy(it.id, 'secret')}
												title={it.type === 'key' ? (t('credential.copy_key', '复制私钥') as string) : (t('credential.copy_password', '复制密码') as string)}>
												<Copy size={16} />
											</IconButton>
											{it.type === 'key' && (
												<IconButton
													variant="soft"
													color="violet"
													onClick={() => revealAndCopy(it.id, 'passphrase')}
													title={t('credential.copy_passphrase', '复制 Passphrase') as string}>
													<KeyRound size={16} />
												</IconButton>
											)}
											<IconButton
												variant="soft"
												onClick={() => {
													setUpsertMode('edit')
													setUpsertInitial(it)
													setUpsertOpen(true)
												}}
												title={t('common.edit', '编辑') as string}>
												<Pencil size={16} />
											</IconButton>
											<IconButton variant="soft" color="red" onClick={() => setDeleteTarget(it)} title={t('common.delete', '删除') as string}>
												<Trash2 size={16} />
											</IconButton>
										</Flex>
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</div>

			<CredentialUpsertDialog
				mode={upsertMode}
				open={upsertOpen}
				onOpenChange={setUpsertOpen}
				initial={upsertInitial}
				onSaved={async () => {
					await fetchList()
					onChange?.()
				}}
			/>

			{/* 删除确认对话框 */}
			<Dialog.Root open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
				<Dialog.Content style={{ maxWidth: 400 }}>
					<Dialog.Title>{t('common.delete', '删除')}</Dialog.Title>
					<Dialog.Description>
						{t('credential.confirm_delete', '确认删除凭据')} <Text weight="bold">{deleteTarget?.name}</Text>？
					</Dialog.Description>
					<Flex gap="2" justify="end" className="mt-4">
						<Dialog.Close>
							<Button variant="soft" color="gray" disabled={deleting}>
								{t('common.cancel', '取消')}
							</Button>
						</Dialog.Close>
						<Button color="red" onClick={() => deleteTarget && remove(deleteTarget.id)} disabled={deleting}>
							{deleting ? t('common.deleting', '删除中...') : t('common.delete', '删除')}
						</Button>
					</Flex>
				</Dialog.Content>
			</Dialog.Root>
		</Card>
	)
}
