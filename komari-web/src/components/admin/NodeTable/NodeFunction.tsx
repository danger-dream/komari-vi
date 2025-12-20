import * as React from 'react'
import { z } from 'zod'
import { schema } from '@/components/admin/NodeTable/schema/node'
import { DataTableRefreshContext } from '@/components/admin/NodeTable/schema/DataTableRefreshContext'
import { Terminal, Trash2, Copy, Download, DollarSign, ChevronDown, ChevronUp } from 'lucide-react'
import { t } from 'i18next'
import type { Row } from '@tanstack/react-table'
import { EditDialog } from './NodeEditDialog'
import { Button, Checkbox, Dialog, Flex, IconButton, SegmentedControl, Text, TextField } from '@radix-ui/themes'
import { toast } from 'sonner'

async function removeClient(uuid: string) {
	await fetch(`/api/admin/client/${uuid}/remove`, {
		method: 'POST'
	})
}

type InstallOptions = {
	disableWebSsh: boolean
	disableAutoUpdate: boolean
	ignoreUnsafeCert: boolean
	ghproxy: string
	dir: string
	serviceName: string
}

type Platform = 'linux' | 'windows' | 'macos'

export function ActionsCell({ row }: { row: Row<z.infer<typeof schema>> }) {
	const refreshTable = React.useContext(DataTableRefreshContext)
	const [removing, setRemoving] = React.useState(false)
	const [selectedPlatform, setSelectedPlatform] = React.useState<Platform>('linux')
	const [endpoint, setEndpoint] = React.useState<string>(window.location.origin.replace(/\/+$/, ''))
	const [installOptions, setInstallOptions] = React.useState<InstallOptions>({
		disableWebSsh: false,
		disableAutoUpdate: false,
		ignoreUnsafeCert: false,
		ghproxy: '',
		dir: '',
		serviceName: ''
	})

	const loadDefaultEndpoint = React.useCallback(async () => {
		try {
			const resp = await fetch('/api/admin/settings/')
			if (!resp.ok) return
			const data = await resp.json().catch(() => ({}))
			const raw = data?.data?.connection_addresses
			const list = typeof raw === 'string' && raw.trim() ? JSON.parse(raw) : []
			const normalized = Array.isArray(list)
				? list
						.map((it: any) => ({
							id: String(it?.id || ''),
							url: String(it?.url || ''),
							is_default: Boolean(it?.is_default)
						}))
						.filter((it: any) => it.id && it.url)
				: []
			const def = normalized.find((it: any) => it.is_default) || normalized[0]
			if (def?.url) setEndpoint(String(def.url).replace(/\/+$/, ''))
		} catch {}
	}, [])

	const generateCommand = () => {
		const token = row.original.token
		let args = ['-e', endpoint, '-t', token]
		// 根据安装选项生成参数
		if (installOptions.disableWebSsh) {
			args.push('--disable-web-ssh')
		}
		if (installOptions.disableAutoUpdate) {
			args.push('--disable-auto-update')
		}
		if (installOptions.ignoreUnsafeCert) {
			args.push('--ignore-unsafe-cert')
		}
		const ghproxyRaw = (installOptions.ghproxy || '').trim()
		if (ghproxyRaw) {
			const ghproxy = ghproxyRaw.startsWith('http') ? ghproxyRaw : `http://${ghproxyRaw}`
			args.push('--install-ghproxy', ghproxy)
		}
		if (installOptions.dir) {
			args.push(`--install-dir`)
			args.push(installOptions.dir)
		}
		if (installOptions.serviceName) {
			args.push(`--install-service-name`)
			args.push(installOptions.serviceName)
		}

		let finalCommand = ''
		switch (selectedPlatform) {
			case 'linux':
				finalCommand = `bash <(curl -fsSL ${endpoint}/api/public/install.sh) ` + args.join(' ')
				break
			case 'windows':
				finalCommand =
					`powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ` +
					`"iwr '${endpoint}/api/public/install.ps1'` +
					` -UseBasicParsing -OutFile 'install.ps1'; &` +
					` '.\\install.ps1'`
				args.forEach(arg => {
					finalCommand += ` '${arg}'`
				})
				finalCommand += `"`
				break
			case 'macos':
				finalCommand = `zsh <(curl -fsSL ${endpoint}/api/public/install.sh) ` + args.join(' ')
				break
		}
		return finalCommand
	}

	const copyToClipboard = async (text: string) => {
		try {
			await navigator.clipboard.writeText(text)
			toast.success(t('copy_success', '已复制到剪贴板'))
		} catch (err) {
			console.error('Failed to copy text: ', err)
		}
	}

	const [showAdvanced, setShowAdvanced] = React.useState(false)

	return (
		<div className="flex gap-3 justify-center">
			<Dialog.Root>
				<Dialog.Trigger>
					<IconButton variant="ghost">
						<Download className="p-1" />
					</IconButton>
				</Dialog.Trigger>
				<Dialog.Content onOpenAutoFocus={() => loadDefaultEndpoint()} style={{ maxWidth: 520 }}>
					<Dialog.Title>{t('admin.nodeTable.installCommand', '一键部署指令')}</Dialog.Title>

					<div className="flex flex-col gap-3">
						{/* 平台选择 + 部署地址 */}
						<div className="grid grid-cols-[auto_1fr] gap-2 items-center">
							<SegmentedControl.Root
								size="1"
								value={selectedPlatform}
								onValueChange={value => setSelectedPlatform(value as Platform)}>
								<SegmentedControl.Item value="linux">Linux</SegmentedControl.Item>
								<SegmentedControl.Item value="windows">Windows</SegmentedControl.Item>
								<SegmentedControl.Item value="macos">macOS</SegmentedControl.Item>
							</SegmentedControl.Root>
							<TextField.Root
								size="2"
								value={endpoint}
								onChange={e => setEndpoint(e.target.value.replace(/\/+$/, ''))}
								placeholder={t('admin.nodeTable.deployEndpoint', '部署地址') as string}
							/>
						</div>

						{/* 基础选项 */}
						<div className="grid grid-cols-3 gap-x-3 gap-y-1">
							<Text as="label" size="2" className="flex items-center gap-2 cursor-pointer select-none">
								<Checkbox
									size="1"
									checked={installOptions.disableWebSsh}
									onCheckedChange={checked => setInstallOptions(prev => ({ ...prev, disableWebSsh: Boolean(checked) }))}
								/>
								{t('admin.nodeTable.disableWebSsh', '禁用 WebSSH')}
							</Text>
							<Text as="label" size="2" className="flex items-center gap-2 cursor-pointer select-none">
								<Checkbox
									size="1"
									checked={installOptions.disableAutoUpdate}
									onCheckedChange={checked => setInstallOptions(prev => ({ ...prev, disableAutoUpdate: Boolean(checked) }))}
								/>
								{t('admin.nodeTable.disableAutoUpdate', '禁用自动更新')}
							</Text>
							<Text as="label" size="2" className="flex items-center gap-2 cursor-pointer select-none">
								<Checkbox
									size="1"
									checked={installOptions.ignoreUnsafeCert}
									onCheckedChange={checked => setInstallOptions(prev => ({ ...prev, ignoreUnsafeCert: Boolean(checked) }))}
								/>
								{t('admin.nodeTable.ignoreUnsafeCert', '忽略不安全证书')}
							</Text>
						</div>

						{/* 高级选项折叠区 */}
						<button
							type="button"
							className="flex items-center gap-1 text-sm text-[var(--accent-11)] hover:text-[var(--accent-12)] transition-colors"
							onClick={() => setShowAdvanced(!showAdvanced)}>
							{showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
							{t('admin.nodeTable.advancedOptions', '高级选项')}
						</button>

						{showAdvanced && (
							<div className="grid grid-cols-1 gap-2 p-3 rounded-md bg-[var(--gray-a2)] border border-[var(--gray-a6)]">
								<div className="grid grid-cols-[100px_1fr] gap-2 items-center">
									<Text size="2" color="gray">
										{t('admin.nodeTable.ghproxy', 'GitHub 代理')}
									</Text>
									<TextField.Root
										size="1"
										placeholder={t('admin.nodeTable.ghproxy_placeholder', '为空则不使用代理') as string}
										value={installOptions.ghproxy}
										onChange={e => setInstallOptions(prev => ({ ...prev, ghproxy: e.target.value }))}
									/>
								</div>
								<div className="grid grid-cols-[100px_1fr] gap-2 items-center">
									<Text size="2" color="gray">
										{t('admin.nodeTable.install_dir', '安装目录')}
									</Text>
									<TextField.Root
										size="1"
										placeholder="/opt/komari-agent"
										value={installOptions.dir}
										onChange={e => setInstallOptions(prev => ({ ...prev, dir: e.target.value }))}
									/>
								</div>
								<div className="grid grid-cols-[100px_1fr] gap-2 items-center">
									<Text size="2" color="gray">
										{t('admin.nodeTable.serviceName', '服务名称')}
									</Text>
									<TextField.Root
										size="1"
										placeholder="komari-agent"
										value={installOptions.serviceName}
										onChange={e => setInstallOptions(prev => ({ ...prev, serviceName: e.target.value }))}
									/>
								</div>
							</div>
						)}

						{/* 生成的命令 */}
						<div>
							<Text size="2" weight="medium" className="block mb-1">
								{t('admin.nodeTable.generatedCommand', '安装命令')}
							</Text>
							<pre
								className="p-3 rounded-md bg-[var(--gray-1)] border border-[var(--gray-a6)] text-[var(--gray-12)] overflow-x-auto whitespace-pre-wrap break-all"
								style={{
									fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
									fontSize: '12px',
									lineHeight: '1.5',
									maxHeight: '120px'
								}}>
								{generateCommand()}
							</pre>
						</div>

						{/* 复制按钮 */}
						<Button className="w-full" onClick={() => copyToClipboard(generateCommand())}>
							<Copy size={14} />
							{t('copy', '复制命令')}
						</Button>
					</div>
				</Dialog.Content>
			</Dialog.Root>
			<a href={`/terminal?uuid=${row.original.uuid}`} target="_blank">
				<IconButton variant="ghost">
					<Terminal className="p-1" />
				</IconButton>
			</a>
			{/** Edit Button */}
			<EditDialog item={row.original} />
			{/** Edit Money */}
			<Dialog.Root>
				<Dialog.Trigger>
					<IconButton variant="ghost">
						<DollarSign className="p-1" />
					</IconButton>
				</Dialog.Trigger>
				<Dialog.Content>
					<Dialog.Title>{t('admin.nodeTable.editNodePrice')}</Dialog.Title>
					<label>123</label>
				</Dialog.Content>
			</Dialog.Root>
			{/** Delete Button */}
			<Dialog.Root>
				<Dialog.Trigger>
					<IconButton variant="ghost" color="red" className="text-destructive">
						<Trash2 className="p-1" />
					</IconButton>
				</Dialog.Trigger>
				<Dialog.Content>
					<Dialog.Title>{t('admin.nodeTable.confirmDelete')}</Dialog.Title>
					<Dialog.Description>{t('admin.nodeTable.cannotUndo')}</Dialog.Description>
					<Flex gap="2" justify={'end'}>
						<Dialog.Close>
							<Button variant="soft">{t('admin.nodeTable.cancel')}</Button>
						</Dialog.Close>
						<Dialog.Trigger>
							<Button
								disabled={removing}
								color="red"
								onClick={async () => {
									setRemoving(true)
									await removeClient(row.original.uuid)
									setRemoving(false)
									if (refreshTable) refreshTable()
								}}>
								{removing ? t('admin.nodeTable.deleting') : t('admin.nodeTable.confirm')}
							</Button>
						</Dialog.Trigger>
					</Flex>
				</Dialog.Content>
			</Dialog.Root>
		</div>
	)
}
