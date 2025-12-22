import { useEffect, useState } from 'react'
import { Badge, Button, Card, Flex, Grid, Select, Table, Text, TextField } from '@radix-ui/themes'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

type RealmBinary = {
	id: number
	os: string
	arch: string
	version: string
	file_path: string
	file_size: number
	file_hash: string
	is_default: boolean
	uploaded_at: string
}

const osOptions = ['linux', 'windows', 'macos']
const archOptions = ['x86_64', 'arm64', 'armv7', 'i686']

const RealmBinaryManager = () => {
	const { t } = useTranslation()
	const [binaries, setBinaries] = useState<RealmBinary[]>([])
	const [loading, setLoading] = useState(false)
	const [uploading, setUploading] = useState(false)
	const [osValue, setOsValue] = useState('linux')
	const [archValue, setArchValue] = useState('x86_64')
	const [version, setVersion] = useState('')
	const [isDefault, setIsDefault] = useState(true)
	const [file, setFile] = useState<File | null>(null)

	const fetchBinaries = async () => {
		setLoading(true)
		try {
			const res = await fetch('/api/v1/realm/binaries')
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			const body = await res.json()
			setBinaries(body.data || [])
		} catch (e: any) {
			toast.error(e?.message || 'Load failed')
		} finally {
			setLoading(false)
		}
	}

	useEffect(() => {
		fetchBinaries()
	}, [])

	const formatBytes = (bytes?: number) => {
		if (!bytes) return '0 B'
		const units = ['B', 'KB', 'MB', 'GB', 'TB']
		let idx = 0
		let value = bytes
		while (value >= 1024 && idx < units.length - 1) {
			value /= 1024
			idx++
		}
		const fixed = value >= 10 || idx === 0 ? 0 : 1
		return `${value.toFixed(fixed)} ${units[idx]}`
	}

	const handleUpload = async () => {
		if (!file) {
			toast.error(t('forward.realmBinarySelect', { defaultValue: '请选择文件' }))
			return
		}
		if (!version.trim()) {
			toast.error(t('forward.realmBinaryVersionRequired', { defaultValue: '版本号不能为空' }))
			return
		}
		const form = new FormData()
		form.append('os', osValue)
		form.append('arch', archValue)
		form.append('version', version.trim())
		form.append('is_default', String(isDefault))
		form.append('file', file)
		setUploading(true)
		try {
			const res = await fetch('/api/v1/realm/binaries', { method: 'POST', body: form })
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			toast.success(t('forward.realmBinaryUploaded', { defaultValue: '上传成功' }))
			setVersion('')
			setFile(null)
			fetchBinaries()
		} catch (e: any) {
			toast.error(e?.message || 'Upload failed')
		} finally {
			setUploading(false)
		}
	}

	const handleDelete = async (id: number) => {
		try {
			const res = await fetch(`/api/v1/realm/binaries/${id}`, { method: 'DELETE' })
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			toast.success(t('common.success'))
			fetchBinaries()
		} catch (e: any) {
			toast.error(e?.message || 'Delete failed')
		}
	}

	return (
		<Card className="mt-4">
			<Flex justify="between" align="center" mb="3">
				<Text weight="bold">{t('forward.realmBinaryTitle', { defaultValue: 'Realm二进制文件管理' })}</Text>
				<Button variant="ghost" onClick={fetchBinaries} disabled={loading}>
					{t('forward.refresh')}
				</Button>
			</Flex>

			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.ColumnHeaderCell>{t('forward.os', { defaultValue: '系统' })}</Table.ColumnHeaderCell>
						<Table.ColumnHeaderCell>{t('forward.arch', { defaultValue: '架构' })}</Table.ColumnHeaderCell>
						<Table.ColumnHeaderCell>{t('forward.version', { defaultValue: '版本' })}</Table.ColumnHeaderCell>
						<Table.ColumnHeaderCell>{t('forward.size', { defaultValue: '大小' })}</Table.ColumnHeaderCell>
						<Table.ColumnHeaderCell>{t('forward.default', { defaultValue: '默认' })}</Table.ColumnHeaderCell>
						<Table.ColumnHeaderCell>{t('forward.actions')}</Table.ColumnHeaderCell>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{binaries.length === 0 ? (
						<Table.Row>
							<Table.Cell colSpan={6}>
								<Text size="2" color="gray">
									{t('forward.realmBinaryEmpty', { defaultValue: '暂无二进制文件' })}
								</Text>
							</Table.Cell>
						</Table.Row>
					) : (
						binaries.map(item => (
							<Table.Row key={item.id}>
								<Table.Cell>{item.os}</Table.Cell>
								<Table.Cell>{item.arch}</Table.Cell>
								<Table.Cell>{item.version}</Table.Cell>
								<Table.Cell>{formatBytes(item.file_size)}</Table.Cell>
								<Table.Cell>
									{item.is_default ? <Badge color="green">{t('common.default', { defaultValue: '默认' })}</Badge> : '-'}
								</Table.Cell>
								<Table.Cell>
									<Flex gap="2">
										<Button size="1" variant="soft" onClick={() => window.open(`/api/v1/realm/binaries/${item.id}/download`, '_blank')}>
											{t('forward.download', { defaultValue: '下载' })}
										</Button>
										<Button size="1" variant="soft" color="red" onClick={() => handleDelete(item.id)}>
											{t('forward.delete', { defaultValue: '删除' })}
										</Button>
									</Flex>
								</Table.Cell>
							</Table.Row>
						))
					)}
				</Table.Body>
			</Table.Root>

			<Card className="mt-4 p-3">
				<Text size="2" weight="bold">
					{t('forward.realmBinaryUpload', { defaultValue: '上传新版本' })}
				</Text>
				<Grid columns="2" gap="3" mt="3">
					<div className="flex flex-col gap-2">
						<Text size="2">{t('forward.os', { defaultValue: '系统' })}</Text>
						<Select.Root value={osValue} onValueChange={setOsValue}>
							<Select.Trigger />
							<Select.Content>
								{osOptions.map(os => (
									<Select.Item key={os} value={os}>
										{os}
									</Select.Item>
								))}
							</Select.Content>
						</Select.Root>
					</div>
					<div className="flex flex-col gap-2">
						<Text size="2">{t('forward.arch', { defaultValue: '架构' })}</Text>
						<Select.Root value={archValue} onValueChange={setArchValue}>
							<Select.Trigger />
							<Select.Content>
								{archOptions.map(arch => (
									<Select.Item key={arch} value={arch}>
										{arch}
									</Select.Item>
								))}
							</Select.Content>
						</Select.Root>
					</div>
					<div className="flex flex-col gap-2">
						<Text size="2">{t('forward.version', { defaultValue: '版本' })}</Text>
						<TextField.Root value={version} onChange={e => setVersion(e.target.value)} placeholder="2.6.0" />
					</div>
					<div className="flex flex-col gap-2">
						<Text size="2">{t('forward.file', { defaultValue: '文件' })}</Text>
						<input type="file" onChange={e => setFile(e.target.files?.[0] || null)} />
					</div>
				</Grid>
				<Flex align="center" gap="2" mt="3">
					<label className="flex items-center gap-2 text-sm">
						<input type="checkbox" checked={isDefault} onChange={e => setIsDefault(e.target.checked)} />
						{t('forward.default', { defaultValue: '默认版本' })}
					</label>
				</Flex>
				<Button className="mt-3" onClick={handleUpload} disabled={uploading}>
					{t('forward.upload', { defaultValue: '上传' })}
				</Button>
			</Card>
		</Card>
	)
}

export default RealmBinaryManager
