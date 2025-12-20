import React, { useEffect, useReducer, useRef, useCallback, useState } from 'react'
import { Flex, TextField, Button, Checkbox, Text, Dialog, TextArea, Box, Callout, SegmentedControl, IconButton } from '@radix-ui/themes'
import { Plus, ArrowLeft, Loader2, CheckCircle, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { CredentialCreateDialog } from '@/components/admin/CredentialManagerDialog'

// --- Types ---
type CredentialItem = { id: number; name: string; username: string; type: string }
type ConnectionAddressItem = { id: string; name: string; url: string; is_default: boolean }
type InstallStatus = 'idle' | 'testing' | 'installing' | 'error' | 'success'
type Platform = 'linux' | 'macos'

interface AddNodeDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	onSuccess: () => void
}

// --- Reducer, State, and Actions ---
const initialState = {
	step: 1,
	status: 'idle' as InstallStatus,
	nodeName: '',
	useSsh: true, // Default to true for the new stepper UI
	sshHost: '',
	sshPort: 22,
	sshCredentialId: '' as number | '',
	sshAuthType: 'password' as 'password' | 'key' | 'credential',
	sshUsername: 'root',
	sshPassword: '',
	sshPrivateKey: '',
	sshKeyPassphrase: '',
	credentialItems: [] as CredentialItem[],
	credentialLoading: false,
	installLogs: '',
	createdUUID: '',
	createdToken: '',
	error: ''
}

type State = typeof initialState
type Action =
	| { type: 'SET_FIELD'; field: keyof State; payload: any }
	| { type: 'NEXT_STEP' }
	| { type: 'PREVIOUS_STEP' }
	| { type: 'SET_CREDENTIALS'; payload: CredentialItem[] }
	| { type: 'RESET' }

function reducer(state: State, action: Action): State {
	switch (action.type) {
		case 'SET_FIELD':
			return { ...state, [action.field]: action.payload }
		case 'NEXT_STEP':
			return { ...state, step: Math.min(state.step + 1, 4), error: '' }
		case 'PREVIOUS_STEP':
			return { ...state, step: Math.max(state.step - 1, 1), error: '' }
		case 'SET_CREDENTIALS':
			return { ...state, credentialItems: action.payload, credentialLoading: false }
		case 'RESET':
			return {
				...initialState,
				credentialItems: state.credentialItems // Keep credentials to avoid re-fetching
			}
		default:
			return state
	}
}

export const AddNodeDialog: React.FC<AddNodeDialogProps> = ({ open, onOpenChange, onSuccess }) => {
	const { t } = useTranslation()
	const [state, dispatch] = useReducer(reducer, initialState)
	const esRef = useRef<EventSource | null>(null)

	const [selectedPlatform, setSelectedPlatform] = useState<Platform>('linux')
	const [endpointOptions, setEndpointOptions] = useState<Array<{ id: string; name: string; url: string; is_default: boolean }>>([])
	const [selectedEndpointId, setSelectedEndpointId] = useState<string>('')
	const [endpoint, setEndpoint] = useState<string>(window.location.origin.replace(/\/+$/, ''))
	const [installOptions, setInstallOptions] = useState({
		disableWebSsh: false,
		disableAutoUpdate: false,
		ignoreUnsafeCert: false,
		memoryIncludeCache: false,
		dir: '',
		serviceName: '',
		includeNics: '',
		excludeNics: '',
		includeMountpoints: '',
		monthRotate: ''
	})
	const [enableCustomDir, setEnableCustomDir] = useState(false)
	const [enableCustomServiceName, setEnableCustomServiceName] = useState(false)
	const [enableIncludeNics, setEnableIncludeNics] = useState(false)
	const [enableExcludeNics, setEnableExcludeNics] = useState(false)
	const [enableIncludeMountpoints, setEnableIncludeMountpoints] = useState(false)
	const [enableMonthRotate, setEnableMonthRotate] = useState(false)
	const [command, setCommand] = useState<string>('')
	const [commandEdited, setCommandEdited] = useState(false)

	const stripAnsi = useCallback((input: string) => {
		if (!input) return ''
		return (
			input
				// OSC sequences
				.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
				// CSI sequences
				.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
				// Remove stray carriage returns (curl progress etc.)
				.replace(/\r/g, '')
		)
	}, [])

	const handleFieldChange = (field: keyof State, payload: any) => {
		dispatch({ type: 'SET_FIELD', field, payload })
	}

	const resolveDefaultEndpoint = useCallback(async () => {
		const fallback = window.location.origin.replace(/\/+$/, '')
		try {
			const resp = await fetch('/api/admin/settings/')
			if (!resp.ok) return fallback
			const data = await resp.json().catch(() => ({}))
			const raw = data?.data?.connection_addresses
			const list = typeof raw === 'string' && raw.trim() ? JSON.parse(raw) : []
			const normalized: ConnectionAddressItem[] = Array.isArray(list)
				? list
						.map((it: any) => ({
							id: String(it?.id || ''),
							name: String(it?.name || ''),
							url: String(it?.url || ''),
							is_default: Boolean(it?.is_default)
						}))
						.filter((it: any) => it.id && it.url)
				: []
			const def = normalized.find(it => it.is_default) || normalized[0]
			return (def?.url ? String(def.url) : fallback).replace(/\/+$/, '')
		} catch {
			return fallback
		}
	}, [])

	const loadEndpointOptions = useCallback(async () => {
		const fallback = window.location.origin.replace(/\/+$/, '')
		try {
			const resp = await fetch('/api/admin/settings/')
			if (!resp.ok) {
				setEndpointOptions([])
				setEndpoint(fallback)
				setSelectedEndpointId('')
				return
			}
			const data = await resp.json().catch(() => ({}))
			const raw = data?.data?.connection_addresses
			const list = typeof raw === 'string' && raw.trim() ? JSON.parse(raw) : []
			const normalized: Array<{ id: string; name: string; url: string; is_default: boolean }> = Array.isArray(list)
				? list
						.map((it: any) => ({
							id: String(it?.id || ''),
							name: String(it?.name || ''),
							url: String(it?.url || ''),
							is_default: Boolean(it?.is_default)
						}))
						.filter((it: any) => it.id && it.url)
				: []
			setEndpointOptions(normalized)
			const def = normalized.find(it => it.is_default) || normalized[0]
			if (def?.url) {
				setEndpoint(String(def.url).replace(/\/+$/, ''))
				setSelectedEndpointId(def.id)
			} else {
				setEndpoint(fallback)
				setSelectedEndpointId('')
			}
		} catch {
			setEndpointOptions([])
			setEndpoint(fallback)
			setSelectedEndpointId('')
		}
	}, [])

	const generateInstallCommand = useCallback(
		(tokenValue: string) => {
			const host = (endpoint || '').trim().replace(/\/+$/, '')
			const token = tokenValue || '__TOKEN__'
			let args: string[] = ['-e', host, '-t', token]
			if (installOptions.disableWebSsh) args.push('--disable-web-ssh')
			if (installOptions.disableAutoUpdate) args.push('--disable-auto-update')
			if (installOptions.ignoreUnsafeCert) args.push('--ignore-unsafe-cert')
			if (installOptions.memoryIncludeCache) args.push('--memory-include-cache')
			if (enableCustomDir && installOptions.dir) args.push('--install-dir', installOptions.dir)
			if (enableCustomServiceName && installOptions.serviceName) args.push('--install-service-name', installOptions.serviceName)
			if (enableIncludeNics && installOptions.includeNics) args.push('--include-nics', installOptions.includeNics)
			if (enableExcludeNics && installOptions.excludeNics) args.push('--exclude-nics', installOptions.excludeNics)
			if (enableIncludeMountpoints && installOptions.includeMountpoints) args.push('--include-mountpoint', installOptions.includeMountpoints)
			if (enableMonthRotate) args.push('--month-rotate', (installOptions.monthRotate || '').trim() || '1')

			const scriptFile = 'install.sh'
			const scriptUrl = `${host}/api/public/${scriptFile}`
			switch (selectedPlatform) {
				case 'linux':
					return `bash <(curl -sL ${scriptUrl}) ` + args.join(' ')
				case 'macos':
					return `zsh <(curl -sL ${scriptUrl}) ` + args.join(' ')
			}
		},
		[
			enableCustomDir,
			enableCustomServiceName,
			enableExcludeNics,
			enableIncludeMountpoints,
			enableIncludeNics,
			enableMonthRotate,
			endpoint,
			installOptions.disableAutoUpdate,
			installOptions.disableWebSsh,
			installOptions.dir,
			installOptions.excludeNics,
			installOptions.ignoreUnsafeCert,
			installOptions.includeMountpoints,
			installOptions.includeNics,
			installOptions.memoryIncludeCache,
			installOptions.monthRotate,
			installOptions.serviceName,
			selectedPlatform
		]
	)

	useEffect(() => {
		if (!state.useSsh) return
		if (commandEdited) return
		setCommand(generateInstallCommand(state.createdToken))
	}, [commandEdited, generateInstallCommand, state.createdToken, state.useSsh])

	// --- Data Fetching Callbacks ---
	const fetchCredentials = useCallback(async () => {
		handleFieldChange('credentialLoading', true)
		try {
			const resp = await fetch('/api/admin/credential')
			if (!resp.ok) throw new Error(resp.statusText)
			const data = await resp.json()
			dispatch({ type: 'SET_CREDENTIALS', payload: data?.data ?? [] })
		} catch (e) {
			console.error('Failed to fetch credentials', e)
			handleFieldChange('credentialLoading', false)
		}
	}, [])

	// --- Dialog Open/Close Effect ---
	useEffect(() => {
		if (open) {
			dispatch({ type: 'RESET' })
			fetchCredentials()
			loadEndpointOptions()
			setCommandEdited(false)
		} else {
			esRef.current?.close()
			esRef.current = null
		}
	}, [fetchCredentials, loadEndpointOptions, open])

	const createNode = useCallback(async () => {
		if (state.createdUUID && state.createdToken) return { uuid: state.createdUUID, token: state.createdToken }
		const resp = await fetch('/api/admin/client/add', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: state.nodeName || '' })
		})
		if (!resp.ok) throw new Error(await resp.text())
		const created = await resp.json().catch(() => ({}))
		const uuid = created?.uuid as string | undefined
		const token = (created?.token as string | undefined) || ''
		if (!uuid) throw new Error('Missing client UUID in server response.')
		dispatch({ type: 'SET_FIELD', field: 'createdUUID', payload: uuid })
		dispatch({ type: 'SET_FIELD', field: 'createdToken', payload: token })
		return { uuid, token }
	}, [state.createdToken, state.createdUUID, state.nodeName])

	// --- Installation Logic (Step 4) ---
	const handleInstall = useCallback(async () => {
		dispatch({ type: 'SET_FIELD', field: 'status', payload: 'testing' })
		dispatch({ type: 'SET_FIELD', field: 'error', payload: '' })

		let logs = t('admin.nodeTable.logs.creatingNode', 'Creating node entry...')
		dispatch({ type: 'SET_FIELD', field: 'installLogs', payload: logs })

		let clientUUID: string | undefined
		let tempCredentialId = 0
		const cleanupTempCredential = async () => {
			if (!tempCredentialId) return
			try {
				await fetch(`/api/admin/credential/${tempCredentialId}`, { method: 'DELETE' })
			} catch {
				// best-effort cleanup
			} finally {
				tempCredentialId = 0
			}
		}

		try {
			// 1. Create Node (if needed)
			const createdNode = await createNode()
			clientUUID = createdNode.uuid
			const clientToken = createdNode.token
			logs += `\n${t('admin.nodeTable.logs.nodeCreated', 'Node entry created.')}`
			dispatch({ type: 'SET_FIELD', field: 'installLogs', payload: logs })

			// 2. Prepare or get credential
			let credentialIdToUse = 0
			if (state.sshAuthType === 'credential') {
				credentialIdToUse = Number(state.sshCredentialId)
			} else {
				logs += `\n${t('admin.nodeTable.logs.creatingCredential', 'Creating temporary credential...')}`
				dispatch({ type: 'SET_FIELD', field: 'installLogs', payload: logs })
				const user = state.sshUsername.trim() || 'root'
				const name = `ssh-auto-${user}-${Date.now()}`
				const body =
					state.sshAuthType === 'password'
						? { name, username: user, type: 'password', secret: state.sshPassword, remark: `Auto-created` }
						: { name, username: user, type: 'key', secret: state.sshPrivateKey, passphrase: state.sshKeyPassphrase || '', remark: `Auto-created` }
				const cResp = await fetch('/api/admin/credential', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(body)
				})
				if (!cResp.ok) throw new Error(await cResp.text())
				const cData = await cResp.json().catch(() => ({}))
				const createdId = Number(cData?.data?.id || 0)
				if (!createdId) throw new Error('Failed to create temporary credential.')
				credentialIdToUse = createdId
				tempCredentialId = createdId
				logs += `\n${t('admin.nodeTable.logs.credentialCreated', 'Temporary credential created.')}`
				dispatch({ type: 'SET_FIELD', field: 'installLogs', payload: logs })
			}

			// 3. Test SSH Connection
			dispatch({ type: 'SET_FIELD', field: 'status', payload: 'testing' })
			logs += `\n${t('admin.nodeTable.logs.testingConnection', 'Testing SSH connection...')}`
			dispatch({ type: 'SET_FIELD', field: 'installLogs', payload: logs })
			const target = { host: state.sshHost.trim(), port: state.sshPort, credential_id: credentialIdToUse }
			const testResp = await fetch('/api/admin/ssh/test', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ target })
			})
			if (!testResp.ok) {
				const err = await testResp.json().catch(() => ({}))
				throw new Error(err?.message || err?.error || testResp.statusText)
			}
			logs += `\n${t('admin.nodeTable.logs.connectionSuccess', 'SSH connection successful.')}`
			dispatch({ type: 'SET_FIELD', field: 'installLogs', payload: logs })

			// 4. Start Installation and Stream Logs
			dispatch({ type: 'SET_FIELD', field: 'status', payload: 'installing' })
			logs += `\n\n${t('admin.nodeTable.logs.startingInstall', 'Starting agent installation...')}\n-------------------------------------\n`
			dispatch({ type: 'SET_FIELD', field: 'installLogs', payload: logs })

			const endpointValue = (endpoint || (await resolveDefaultEndpoint())).replace(/\/+$/, '')
			const finalCommand = (command || '').replace(/__TOKEN__/g, clientToken)
			const installResp = await fetch('/api/admin/ssh/install', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ client_uuid: clientUUID, endpoint: endpointValue, target, command: finalCommand })
			})
			if (!installResp.ok) {
				const err = await installResp.json().catch(() => ({}))
				throw new Error(err?.message || err?.error || installResp.statusText)
			}
			const installData = await installResp.json().catch(() => ({}))
			const sessionId = installData?.data?.session_id as string | undefined
			if (!sessionId) throw new Error('Missing session_id in server response.')

			esRef.current?.close()
			const es = new EventSource(`/api/admin/ssh/install/${sessionId}/stream`)
			esRef.current = es
				es.onmessage = e => {
					logs += '\n' + stripAnsi(e.data)
					dispatch({ type: 'SET_FIELD', field: 'installLogs', payload: logs })
				}
			es.addEventListener('done', (e: MessageEvent) => {
				const err = (e as any)?.data || ''
				if (err) {
					dispatch({ type: 'SET_FIELD', field: 'error', payload: err })
					dispatch({ type: 'SET_FIELD', field: 'status', payload: 'error' })
				} else {
					dispatch({ type: 'SET_FIELD', field: 'status', payload: 'success' })
					logs += `\n-------------------------------------\n${t('admin.nodeTable.logs.installSuccess', 'Installation completed successfully!')}`
					dispatch({ type: 'SET_FIELD', field: 'installLogs', payload: logs })
					onSuccess()
				}
				es.close()
				esRef.current = null
				cleanupTempCredential()
			})
			es.onerror = () => {
				dispatch({ type: 'SET_FIELD', field: 'error', payload: 'Log stream connection failed.' })
				dispatch({ type: 'SET_FIELD', field: 'status', payload: 'error' })
				es.close()
				esRef.current = null
				cleanupTempCredential()
			}
		} catch (error) {
			await cleanupTempCredential()
			if (clientUUID) {
				// Rollback node creation if something failed after
				try {
					await fetch(`/api/admin/client/${clientUUID}/remove`, { method: 'POST' })
				} catch {}
			}
			const errorMessage = error instanceof Error ? error.message : String(error)
			dispatch({ type: 'SET_FIELD', field: 'error', payload: errorMessage })
			dispatch({ type: 'SET_FIELD', field: 'status', payload: 'error' })
			dispatch({ type: 'SET_FIELD', field: 'installLogs', payload: logs + '\n\n[FATAL] ' + errorMessage })
		}
	}, [
		command,
		createNode,
		endpoint,
		resolveDefaultEndpoint,
		state.nodeName,
		state.sshAuthType,
		state.sshCredentialId,
		state.sshHost,
		state.sshKeyPassphrase,
		state.sshPassword,
		state.sshPort,
		state.sshPrivateKey,
		state.sshUsername,
		t,
		onSuccess
	])

	const renderStepContent = () => {
		switch (state.step) {
			case 1:
				return (
					<Flex direction="column" gap="4">
						<Box>
							<Text as="label" size="2" weight="medium" mb="1">
								{t('admin.nodeTable.nameOptional', '节点名称（可选）')}
							</Text>
							<TextField.Root
								value={state.nodeName}
								autoComplete="off"
								onChange={e => handleFieldChange('nodeName', e.target.value)}
								placeholder={t('admin.nodeTable.namePlaceholder', '例如：我的新服务器')}
								className='mt-2'
							/>
						</Box>
						<Text as="label" size="2" className="flex items-center gap-2 cursor-pointer select-none">
							<Checkbox checked={state.useSsh} onCheckedChange={v => handleFieldChange('useSsh', Boolean(v))} />
							{t('admin.nodeTable.useSshInstall', '使用 SSH 自动安装（Linux/macOS，仅 root）')}
						</Text>
					</Flex>
				)
			case 2:
				return (
					<Flex direction="column" gap="3">
						<div className="grid grid-cols-[1fr_100px] gap-3">
							<div>
								<Text size="2" weight="medium" className="block mb-1">
									{t('admin.nodeTable.sshHost', '地址')}
								</Text>
								<TextField.Root
									size="2"
									value={state.sshHost}
									onChange={e => handleFieldChange('sshHost', e.target.value)}
									placeholder="IP or domain"
									autoComplete="off"
								/>
							</div>
							<div>
								<Text size="2" weight="medium" className="block mb-1">
									{t('admin.nodeTable.sshPort', '端口')}
								</Text>
								<TextField.Root
									size="2"
									type="number"
									value={String(state.sshPort)}
									onChange={e => handleFieldChange('sshPort', Number(e.target.value || 22))}
									autoComplete="off"
								/>
							</div>
						</div>
						<div>
							<Text size="2" weight="medium" className="block mb-2">
								{t('admin.nodeTable.accountType', '认证方式')}
							</Text>
							<SegmentedControl.Root value={state.sshAuthType} onValueChange={v => handleFieldChange('sshAuthType', v as any)}>
								<SegmentedControl.Item value="password">{t('admin.nodeTable.accountPassword', '密码')}</SegmentedControl.Item>
								<SegmentedControl.Item value="key">{t('admin.nodeTable.accountKey', '私钥')}</SegmentedControl.Item>
								<SegmentedControl.Item value="credential">{t('admin.nodeTable.credential', '凭据')}</SegmentedControl.Item>
							</SegmentedControl.Root>
						</div>
						{state.sshAuthType === 'password' && (
							<div className="grid grid-cols-2 gap-3">
								<div>
									<Text size="2" weight="medium" className="block mb-1">
										{t('credential.username', '用户')}
									</Text>
									<TextField.Root
										size="2"
										value={state.sshUsername}
										onChange={e => handleFieldChange('sshUsername', e.target.value)}
										placeholder="root"
										autoComplete="off"
									/>
								</div>
								<div>
									<Text size="2" weight="medium" className="block mb-1">
										{t('credential.password', '密码')}
									</Text>
									<TextField.Root
										size="2"
										type="password"
										value={state.sshPassword}
										onChange={e => handleFieldChange('sshPassword', e.target.value)}
										autoComplete="off"
									/>
								</div>
							</div>
						)}
						{state.sshAuthType === 'key' && (
							<div className="flex flex-col gap-3">
								<div className="grid grid-cols-2 gap-3">
									<div>
										<Text size="2" weight="medium" className="block mb-1">
											{t('credential.username', '用户')}
										</Text>
										<TextField.Root
											size="2"
											value={state.sshUsername}
											onChange={e => handleFieldChange('sshUsername', e.target.value)}
											placeholder="root"
											autoComplete="off"
										/>
									</div>
									<div>
										<Text size="2" weight="medium" className="block mb-1">
											{t('credential.passphrase', 'Passphrase')}
										</Text>
										<TextField.Root
											size="2"
											type="password"
											value={state.sshKeyPassphrase}
											onChange={e => handleFieldChange('sshKeyPassphrase', e.target.value)}
											placeholder={t('common.optional', '可选') as string}
											autoComplete="off"
										/>
									</div>
								</div>
								<div>
									<Text size="2" weight="medium" className="block mb-1">
										{t('credential.private_key', '私钥')}
									</Text>
									<TextArea
										value={state.sshPrivateKey}
										onChange={e => handleFieldChange('sshPrivateKey', e.target.value)}
										placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
										style={{ minHeight: 80, fontFamily: 'monospace', fontSize: '12px' }}
									/>
								</div>
							</div>
						)}
						{state.sshAuthType === 'credential' && (
							<div>
								<Flex justify="between" align="center" className="mb-2">
									<Text size="2" weight="medium">
										{t('admin.nodeTable.credential', '选择凭据')}
									</Text>
									<CredentialCreateDialog
										onSaved={fetchCredentials}
										trigger={
											<Button size="1" variant="ghost">
												<Plus size={12} /> {t('credential.create', '新增凭据')}
											</Button>
										}
									/>
								</Flex>
								<Box className="p-2 border rounded-lg bg-(--gray-a2) max-h-36 overflow-y-auto">
									<Flex direction="column" gap="2">
										{state.credentialLoading ? (
											<Text size="2" color="gray">
												{t('loading', '加载中...')}
											</Text>
										) : state.credentialItems.length > 0 ? (
											state.credentialItems.map(it => (
												<Text as="label" size="2" key={it.id} className="flex items-center gap-2 cursor-pointer">
													<input
														type="radio"
														name="credential"
														value={it.id}
														checked={state.sshCredentialId === it.id}
														onChange={() => handleFieldChange('sshCredentialId', it.id)}
													/>
													{it.name}{' '}
													<span className="text-gray-500">
														({it.username} / {it.type === 'key' ? '密钥' : '密码'})
													</span>
												</Text>
											))
										) : (
											<Text size="2" color="gray">
												{t('admin.nodeTable.noCredentials', '没有可用的凭据。')}
											</Text>
										)}
									</Flex>
								</Box>
							</div>
						)}
					</Flex>
				)
			case 3: {
				return (
					<Flex direction="column" gap="4">
						<SegmentedControl.Root value={selectedPlatform} onValueChange={v => setSelectedPlatform(v as Platform)}>
							<SegmentedControl.Item value="linux">Linux</SegmentedControl.Item>
							<SegmentedControl.Item value="macos">macOS</SegmentedControl.Item>
						</SegmentedControl.Root>
						<Flex direction="column" gap="2">
							<Text size="2" weight="medium">
								{t('admin.nodeTable.deployEndpoint', '部署地址')}
							</Text>
							{endpointOptions.length === 0 ? (
								<Callout.Root color="red" variant="soft">
									<Callout.Text>{t('admin.nodeTable.connectionAddressRequired', '请先在设置中配置“连接地址”')}</Callout.Text>
								</Callout.Root>
							) : (
								<div className="flex flex-col gap-2">
									{endpointOptions.map(it => (
										<label key={it.id} className="flex items-start gap-2 text-sm cursor-pointer select-none">
											<input
												type="radio"
												name="deploy-endpoint"
												checked={selectedEndpointId === it.id}
												onChange={() => {
													setSelectedEndpointId(it.id)
													setEndpoint(String(it.url).replace(/\/+$/, ''))
												}}
											/>
											<div className="flex flex-col leading-tight">
												<span className="font-medium">{it.name || it.url}</span>
												<span className="font-mono text-(--gray-11)">{it.url}</span>
											</div>
										</label>
									))}
								</div>
							)}
						</Flex>
						<Flex direction="column" gap="2">
							<Text size="2" weight="medium">
								{t('admin.nodeTable.installOptions', '安装选项')}
							</Text>
							<div className="grid grid-cols-2 gap-2">
								<Flex gap="2" align="center">
									<Checkbox
										checked={installOptions.disableWebSsh}
										onCheckedChange={v => setInstallOptions(p => ({ ...p, disableWebSsh: Boolean(v) }))}
									/>
									<label
										className="text-sm cursor-pointer"
										onClick={() => setInstallOptions(p => ({ ...p, disableWebSsh: !p.disableWebSsh }))}>
										{t('admin.nodeTable.disableWebSsh')}
									</label>
								</Flex>
								<Flex gap="2" align="center">
									<Checkbox
										checked={installOptions.disableAutoUpdate}
										onCheckedChange={v => setInstallOptions(p => ({ ...p, disableAutoUpdate: Boolean(v) }))}
									/>
									<label
										className="text-sm cursor-pointer"
										onClick={() => setInstallOptions(p => ({ ...p, disableAutoUpdate: !p.disableAutoUpdate }))}>
										{t('admin.nodeTable.disableAutoUpdate', '禁用自动更新')}
									</label>
								</Flex>
								<Flex gap="2" align="center">
									<Checkbox
										checked={installOptions.ignoreUnsafeCert}
										onCheckedChange={v => setInstallOptions(p => ({ ...p, ignoreUnsafeCert: Boolean(v) }))}
									/>
									<label
										className="text-sm cursor-pointer"
										onClick={() => setInstallOptions(p => ({ ...p, ignoreUnsafeCert: !p.ignoreUnsafeCert }))}>
										{t('admin.nodeTable.ignoreUnsafeCert', '忽略不安全证书')}
									</label>
								</Flex>
								<Flex gap="2" align="center">
									<Checkbox
										checked={installOptions.memoryIncludeCache}
										onCheckedChange={v => setInstallOptions(p => ({ ...p, memoryIncludeCache: Boolean(v) }))}
									/>
									<label
										className="text-sm cursor-pointer"
										onClick={() => setInstallOptions(p => ({ ...p, memoryIncludeCache: !p.memoryIncludeCache }))}>
										{t('admin.nodeTable.memoryModeAvailable', '监测可用内存')}
									</label>
								</Flex>
							</div>

							<Flex direction="column" gap="2">
								<Flex gap="2" align="center">
									<Checkbox
										checked={enableCustomDir}
										onCheckedChange={v => {
											const on = Boolean(v)
											setEnableCustomDir(on)
											if (!on) setInstallOptions(p => ({ ...p, dir: '' }))
										}}
									/>
									<label
										className="text-sm font-bold cursor-pointer"
										onClick={() => {
											const on = !enableCustomDir
											setEnableCustomDir(on)
											if (!on) setInstallOptions(p => ({ ...p, dir: '' }))
										}}>
										{t('admin.nodeTable.install_dir', '安装目录')}
									</label>
								</Flex>
								{enableCustomDir && (
									<TextField.Root
										placeholder={t('admin.nodeTable.install_dir_placeholder', '安装目录，为空则使用默认目录(/opt/komari-agent)')}
										value={installOptions.dir}
										onChange={e => setInstallOptions(p => ({ ...p, dir: e.target.value }))}
									/>
								)}

								<Flex gap="2" align="center">
									<Checkbox
										checked={enableCustomServiceName}
										onCheckedChange={v => {
											const on = Boolean(v)
											setEnableCustomServiceName(on)
											if (!on) setInstallOptions(p => ({ ...p, serviceName: '' }))
										}}
									/>
									<label
										className="text-sm font-bold cursor-pointer"
										onClick={() => {
											const on = !enableCustomServiceName
											setEnableCustomServiceName(on)
											if (!on) setInstallOptions(p => ({ ...p, serviceName: '' }))
										}}>
										{t('admin.nodeTable.serviceName', '服务名称')}
									</label>
								</Flex>
								{enableCustomServiceName && (
									<TextField.Root
										placeholder={t('admin.nodeTable.serviceName_placeholder', '服务名称，为空则使用默认名称(komari-agent)')}
										value={installOptions.serviceName}
										onChange={e => setInstallOptions(p => ({ ...p, serviceName: e.target.value }))}
									/>
								)}

								<Flex gap="2" align="center">
									<Checkbox
										checked={enableIncludeNics}
										onCheckedChange={v => {
											const on = Boolean(v)
											setEnableIncludeNics(on)
											if (!on) setInstallOptions(p => ({ ...p, includeNics: '' }))
										}}
									/>
									<label
										className="text-sm font-bold cursor-pointer"
										onClick={() => {
											const on = !enableIncludeNics
											setEnableIncludeNics(on)
											if (!on) setInstallOptions(p => ({ ...p, includeNics: '' }))
										}}>
										{t('admin.nodeTable.includeNics', '只监测特定网卡')}
									</label>
								</Flex>
								{enableIncludeNics && (
									<TextField.Root
										placeholder="eth0,eth1"
										value={installOptions.includeNics}
										onChange={e => setInstallOptions(p => ({ ...p, includeNics: e.target.value }))}
									/>
								)}

								<Flex gap="2" align="center">
									<Checkbox
										checked={enableExcludeNics}
										onCheckedChange={v => {
											const on = Boolean(v)
											setEnableExcludeNics(on)
											if (!on) setInstallOptions(p => ({ ...p, excludeNics: '' }))
										}}
									/>
									<label
										className="text-sm font-bold cursor-pointer"
										onClick={() => {
											const on = !enableExcludeNics
											setEnableExcludeNics(on)
											if (!on) setInstallOptions(p => ({ ...p, excludeNics: '' }))
										}}>
										{t('admin.nodeTable.excludeNics', '排除特定网卡')}
									</label>
								</Flex>
								{enableExcludeNics && (
									<TextField.Root
										placeholder="lo"
										value={installOptions.excludeNics}
										onChange={e => setInstallOptions(p => ({ ...p, excludeNics: e.target.value }))}
									/>
								)}

								<Flex gap="2" align="center">
									<Checkbox
										checked={enableIncludeMountpoints}
										onCheckedChange={v => {
											const on = Boolean(v)
											setEnableIncludeMountpoints(on)
											if (!on) setInstallOptions(p => ({ ...p, includeMountpoints: '' }))
										}}
									/>
									<label
										className="text-sm font-bold cursor-pointer"
										onClick={() => {
											const on = !enableIncludeMountpoints
											setEnableIncludeMountpoints(on)
											if (!on) setInstallOptions(p => ({ ...p, includeMountpoints: '' }))
										}}>
										{t('admin.nodeTable.includeMountpoints', '只监测特定挂载点')}
									</label>
								</Flex>
								{enableIncludeMountpoints && (
									<TextField.Root
										placeholder="/;/home;/var"
										value={installOptions.includeMountpoints}
										onChange={e => setInstallOptions(p => ({ ...p, includeMountpoints: e.target.value }))}
									/>
								)}

								<Flex gap="2" align="center">
									<Checkbox
										checked={enableMonthRotate}
										onCheckedChange={v => {
											const on = Boolean(v)
											setEnableMonthRotate(on)
											if (!on) setInstallOptions(p => ({ ...p, monthRotate: '' }))
											else setInstallOptions(p => ({ ...p, monthRotate: (p.monthRotate || '').trim() ? p.monthRotate : '1' }))
										}}
									/>
									<label
										className="text-sm font-bold cursor-pointer"
										onClick={() => {
											const on = !enableMonthRotate
											setEnableMonthRotate(on)
											if (!on) setInstallOptions(p => ({ ...p, monthRotate: '' }))
											else setInstallOptions(p => ({ ...p, monthRotate: (p.monthRotate || '').trim() ? p.monthRotate : '1' }))
										}}>
										{t('admin.nodeTable.monthRotate', '网络统计月重置')}
									</label>
								</Flex>
								{enableMonthRotate && (
									<TextField.Root
										placeholder="1"
										type="number"
										min="1"
										max="31"
										value={installOptions.monthRotate}
										onChange={e => setInstallOptions(p => ({ ...p, monthRotate: e.target.value }))}
									/>
								)}
							</Flex>
						</Flex>

						<Flex direction="column" gap="2">
							<Text size="2" weight="medium">
								{t('admin.nodeTable.generatedCommand', '生成的指令')}
							</Text>
							<TextArea
								value={command}
								onChange={e => {
									setCommandEdited(true)
									setCommand(e.target.value)
								}}
								style={{ minHeight: 80, fontFamily: 'monospace', fontSize: '12px' }}
							/>
							<Button
								variant="soft"
								onClick={() => {
									setCommandEdited(false)
									setCommand(generateInstallCommand(state.createdToken))
								}}>
								{t('common.reset', '重置为自动生成')}
							</Button>
						</Flex>
					</Flex>
				)
			}
			case 4: {
				const Icon = { testing: Loader2, installing: Loader2, success: CheckCircle, error: XCircle, idle: ArrowLeft }[state.status]
				const iconColor = state.status === 'success' ? 'var(--green-9)' : state.status === 'error' ? 'var(--red-9)' : 'var(--gray-9)'
				const statusText = {
					testing: t('admin.nodeTable.logs.testingConnection', '正在测试连接...'),
					installing: t('admin.nodeTable.logs.startingInstall', '正在安装 Agent...'),
					success: t('admin.nodeTable.logs.installSuccess', '安装成功！'),
					error: t('admin.nodeTable.logs.installFailed', '安装失败'),
					idle: ''
				}[state.status]

				return (
					<Flex direction="column" gap="3">
						<Flex align="center" gap="3">
							<Icon size={24} color={iconColor} className={state.status === 'testing' || state.status === 'installing' ? 'animate-spin' : ''} />
							<Text weight="bold">{statusText}</Text>
						</Flex>
						{state.error && (
							<Callout.Root color="red" variant="soft">
								<Callout.Text>{state.error}</Callout.Text>
							</Callout.Root>
						)}
						<TextArea value={state.installLogs} readOnly style={{ minHeight: 240, fontFamily: 'monospace', fontSize: '12px' }} />
					</Flex>
				)
			}
			default:
				return null
		}
	}

	const handleSimpleAdd = async () => {
		dispatch({ type: 'SET_FIELD', field: 'status', payload: 'installing' })
		try {
			const resp = await fetch('/api/admin/client/add', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: state.nodeName || '' })
			})
			if (!resp.ok) throw new Error(await resp.text())
			toast.success(t('admin.nodeTable.addSuccess', '添加成功'))
			onSuccess()
			onOpenChange(false)
		} catch (error) {
			toast.error(`${t('common.error', 'Error')}: ${error instanceof Error ? error.message : String(error)}`)
		} finally {
			dispatch({ type: 'SET_FIELD', field: 'status', payload: 'idle' })
		}
	}

	const handleNext = () => {
		if (state.step === 1) {
			if (state.useSsh) {
				dispatch({ type: 'NEXT_STEP' })
			} else {
				handleSimpleAdd()
			}
			return
		}
		if (state.step === 2) {
			if (!state.sshHost.trim()) {
				toast.error(t('admin.nodeTable.sshHostRequired', '请填写 SSH 地址'))
				return
			}
			if (state.sshAuthType === 'credential' && !state.sshCredentialId) {
				toast.error(t('admin.nodeTable.credentialRequired', '请选择凭据'))
				return
			}
			if ((state.sshAuthType === 'password' && !state.sshPassword.trim()) || (state.sshAuthType === 'key' && !state.sshPrivateKey.trim())) {
				toast.error(t('credential.secret_required', '请填写密码/私钥'))
				return
			}
			dispatch({ type: 'NEXT_STEP' })
			return
		}
	}

	const isLoading = state.status === 'testing' || state.status === 'installing'

	return (
		<Dialog.Content>
			<Dialog.Title className="flex items-center gap-4">
				{state.step > 1 && (
					<IconButton variant="ghost" onClick={() => dispatch({ type: 'PREVIOUS_STEP' })} disabled={isLoading}>
						<ArrowLeft />
					</IconButton>
				)}
				{t('admin.nodeTable.addNode')}
				{state.useSsh && (
					<span className="font-normal text-sm text-(--gray-10)">
						{t('admin.nodeTable.step', '步骤 {{current}} / {{total}}', { current: state.step, total: 4 })}
					</span>
				)}
			</Dialog.Title>

			<Box pt="4">{renderStepContent()}</Box>

			<Flex justify="end" gap="2" mt="4">
				{state.status === 'success' || state.status === 'error' ? (
					<Button onClick={() => onOpenChange(false)}>{t('common.done', '完成')}</Button>
				) : state.step < 3 ? (
					<Button onClick={handleNext} disabled={isLoading}>
						{isLoading && <Loader2 size={16} className="animate-spin mr-2" />}
						{state.step === 1 && !state.useSsh ? t('admin.nodeTable.addNode', '添加节点') : t('common.next', '下一步')}
					</Button>
				) : state.step === 3 ? (
					<>
						<Button
							variant="soft"
							onClick={async () => {
								if (!endpointOptions.length || !selectedEndpointId) {
									toast.error(t('admin.nodeTable.connectionAddressRequired', '请先在设置中配置“连接地址”'))
									return
								}
								try {
									await createNode()
									toast.success(t('admin.nodeTable.addSuccess', '添加成功'))
									onSuccess()
									onOpenChange(false)
								} catch (e) {
									toast.error(`${t('common.error', 'Error')}: ${e instanceof Error ? e.message : String(e)}`)
								}
							}}
							disabled={isLoading}>
							{t('admin.nodeTable.addNode', '创建')}
						</Button>
						<Button
							onClick={async () => {
								if (!endpointOptions.length || !selectedEndpointId) {
									toast.error(t('admin.nodeTable.connectionAddressRequired', '请先在设置中配置“连接地址”'))
									return
								}
								if (!command.trim()) {
									toast.error(t('admin.nodeTable.generatedCommand', '生成的指令') + ' ' + t('common.required', '必填'))
									return
								}
								dispatch({ type: 'NEXT_STEP' })
								await handleInstall()
							}}
							disabled={isLoading}>
							{t('admin.nodeTable.createAndInstall', '创建并安装Agent')}
						</Button>
					</>
				) : null}
			</Flex>
		</Dialog.Content>
	)
}
