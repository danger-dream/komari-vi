import { Badge, Button, Card, Flex, Text, TextField } from '@radix-ui/themes'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Copy, Terminal, FileCode2, RefreshCw } from 'lucide-react'

type InstallScript = {
	id: number
	name: string
	body: string
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

function formatTime(dateStr: string) {
	if (!dateStr) return '-'
	try {
		return new Date(dateStr).toLocaleString()
	} catch {
		return dateStr
	}
}

function getPlatformInfo(scriptName: string) {
	if (scriptName.endsWith('.ps1')) {
		return {
			platform: 'Windows',
			color: 'blue' as const,
			icon: <FileCode2 size={14} />
		}
	}
	return {
		platform: 'Linux / macOS',
		color: 'green' as const,
		icon: <Terminal size={14} />
	}
}

export function InstallScriptManager() {
	const { t } = useTranslation()
	const [installScripts, setInstallScripts] = useState<InstallScript[]>([])
	const [scriptsLoading, setScriptsLoading] = useState(false)
	const [scriptsSaving, setScriptsSaving] = useState<Record<string, boolean>>({})
	const downloadBase = typeof window !== 'undefined' ? window.location.origin.replace(/\/+$/, '') : ''

	const fetchInstallScripts = async () => {
		setScriptsLoading(true)
		try {
			const resp = await fetch('/api/admin/install-script')
			if (!resp.ok) throw new Error(await extractError(resp))
			const data = await resp.json()
			setInstallScripts(data?.data ?? [])
		} catch (error: any) {
			toast.error(t('agent_version.install_script_fetch_failed', '获取部署脚本失败') + ': ' + (error?.message || error))
		} finally {
			setScriptsLoading(false)
		}
	}

	const saveInstallScript = async (name: string, body: string) => {
		setScriptsSaving(prev => ({ ...prev, [name]: true }))
		try {
			const resp = await fetch(`/api/admin/install-script/${encodeURIComponent(name)}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ body })
			})
			if (!resp.ok) throw new Error(await extractError(resp))
			toast.success(t('agent_version.install_script_saved', '部署脚本已保存'))
			await fetchInstallScripts()
		} catch (error: any) {
			toast.error(t('agent_version.install_script_save_failed', '保存部署脚本失败') + ': ' + (error?.message || error))
		} finally {
			setScriptsSaving(prev => ({ ...prev, [name]: false }))
		}
	}

	useEffect(() => {
		fetchInstallScripts()
	}, [])

	return (
		<Card>
			<Flex justify="between" align="center" className="mb-4">
				<div>
					<Text size="5" weight="bold">
						{t('agent_version.install_scripts', '部署脚本')}
					</Text>
					<Text size="2" color="gray" className="block mt-1">
						{t('agent_version.install_scripts_hint', '这些脚本会被一键部署指令与 SSH 自动安装使用')}
					</Text>
				</div>
				<Button variant="soft" onClick={fetchInstallScripts} disabled={scriptsLoading}>
					<RefreshCw size={14} className={scriptsLoading ? 'animate-spin' : ''} />
					{t('agent_version.refresh', '刷新')}
				</Button>
			</Flex>

			{scriptsLoading ? (
				<Flex align="center" justify="center" className="py-8">
					<Text color="gray">{t('loading', '加载中...')}</Text>
				</Flex>
			) : installScripts.length === 0 ? (
				<Flex align="center" justify="center" className="py-8">
					<Text color="gray">{t('agent_version.install_scripts_empty', '暂无脚本')}</Text>
				</Flex>
			) : (
				<div className="flex flex-col gap-4">
					{installScripts.map(s => {
						const platformInfo = getPlatformInfo(s.name)
						return (
							<div key={s.name} className="rounded-lg border border-[var(--gray-a6)] overflow-hidden">
								{/* 脚本头部 */}
								<div className="flex items-center justify-between gap-3 px-4 py-3 bg-[var(--gray-a2)] border-b border-[var(--gray-a6)]">
									<Flex gap="3" align="center">
										<Badge color={platformInfo.color} size="2">
											<Flex gap="1" align="center">
												{platformInfo.icon}
												{platformInfo.platform}
											</Flex>
										</Badge>
										<Text size="2" weight="medium" className="font-mono">
											{s.name}
										</Text>
										<Text size="1" color="gray">
											{t('agent_version.updated_at', '更新时间')}: {formatTime(s.updated_at)}
										</Text>
									</Flex>
									<Button
										size="1"
										onClick={() => saveInstallScript(s.name, s.body)}
										disabled={!!scriptsSaving[s.name]}>
										{scriptsSaving[s.name] ? t('common.saving', '保存中...') : t('common.save', '保存')}
									</Button>
								</div>

								{/* 下载地址 */}
								<div className="px-4 py-2 bg-[var(--gray-a1)] border-b border-[var(--gray-a6)]">
									<Flex gap="2" align="center">
										<Text size="1" color="gray" className="shrink-0">
											{t('agent_version.download_url', '下载地址')}:
										</Text>
										<TextField.Root
											size="1"
											value={`${downloadBase}/api/public/${s.name}`}
											readOnly
											className="flex-1 font-mono"
										/>
										<Button
											size="1"
											variant="soft"
											onClick={async () => {
												await navigator.clipboard.writeText(`${downloadBase}/api/public/${s.name}`)
												toast.success(t('copy_success', '已复制到剪贴板'))
											}}>
											<Copy size={12} />
										</Button>
									</Flex>
								</div>

								{/* 代码编辑区 */}
								<textarea
									value={s.body}
									onChange={e => {
										const next = e.target.value
										setInstallScripts(prev => prev.map(it => (it.name === s.name ? { ...it, body: next } : it)))
									}}
									className="w-full p-4 bg-[var(--gray-1)] text-[var(--gray-12)] border-0 outline-none resize-y"
									style={{
										minHeight: 280,
										fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
										fontSize: '13px',
										lineHeight: '1.5',
										tabSize: 4
									}}
									spellCheck={false}
								/>
							</div>
						)
					})}
				</div>
			)}
		</Card>
	)
}
