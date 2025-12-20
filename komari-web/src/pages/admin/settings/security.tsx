import { useEffect, useState, type ReactNode } from 'react'
import { Button, Card, Flex, Grid, Switch, Text, TextField, TextArea } from '@radix-ui/themes'
import { toast } from 'sonner'

type SecurityConfig = {
	signature_enabled: boolean
	signature_secret: string
	signature_ttl_seconds: number
	nonce_ttl_seconds: number
	nonce_cache_size: number
	require_origin: boolean
	allowed_origins: string[]
	allowed_referers: string[]
	rate_public_per_min: number
	rate_verify_per_min: number
	rate_start_per_min: number
	max_failures_per_ip: number
	failure_lock_minutes: number
	failure_window_seconds: number
}

const numberOrZero = (v: number | string | undefined) => Number(v || 0)

export default function SecuritySettings() {
	const [config, setConfig] = useState<SecurityConfig | null>(null)
	const [loading, setLoading] = useState(false)
	const [saving, setSaving] = useState(false)

	const fetchConfig = async () => {
		setLoading(true)
		try {
			const resp = await fetch('/api/admin/security')
			const data = await resp.json()
			setConfig(data.data || data)
		} catch (e) {
			console.error(e)
			toast.error('加载安全配置失败')
		} finally {
			setLoading(false)
		}
	}

	useEffect(() => {
		fetchConfig()
	}, [])

	const update = async () => {
		if (!config) return
		setSaving(true)
		try {
			const payload = {
				...config,
				allowed_origins: (config.allowed_origins || []).map(s => s.trim()).filter(Boolean),
				allowed_referers: (config.allowed_referers || []).map(s => s.trim()).filter(Boolean)
			}
			const resp = await fetch('/api/admin/security', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			})
			if (!resp.ok) {
				const data = await resp.json().catch(() => ({}))
				throw new Error(data?.message || '保存失败')
			}
			toast.success('已保存安全配置')
			fetchConfig()
		} catch (e: any) {
			toast.error(e?.message || '保存失败')
		} finally {
			setSaving(false)
		}
	}

	if (!config || loading) {
		return (
			<Flex direction="column" gap="3" className="p-4">
				<Text>加载中...</Text>
			</Flex>
		)
	}

	return (
		<Flex direction="column" gap="3" className="p-4">
			<Flex justify="between" align="center">
				<div>
					<Text size="5" weight="bold">
						安全配置
					</Text>
					<Text size="2" color="gray" className="block mt-1">
						限制接口滥用、防爬虫、防重放
					</Text>
				</div>
				<Button onClick={update} disabled={saving}>
					{saving ? '保存中...' : '保存'}
				</Button>
			</Flex>

			<Card>
				<Flex direction="column" gap="4" p="4">
					<Text size="4" weight="bold">
						签名与来源校验
					</Text>
					<Grid columns={{ initial: '1', md: '2' }} gap="3">
						<Field label="启用签名校验">
							<Switch checked={config.signature_enabled} onCheckedChange={v => setConfig({ ...config, signature_enabled: v })} />
							<Text size="1" color="gray">
								需在前端携带 X-Lg-Ts / X-Lg-Nonce / X-Lg-Signature
							</Text>
						</Field>
						<Field label="签名密钥">
							<TextField.Root
								type="text"
								value={config.signature_secret || ''}
								onChange={e => setConfig({ ...config, signature_secret: e.target.value })}
							/>
							<Text size="1" color="gray">
								留空自动生成
							</Text>
						</Field>
						<Field label="签名有效期(秒)">
							<TextField.Root
								type="number"
								value={config.signature_ttl_seconds}
								onChange={e => setConfig({ ...config, signature_ttl_seconds: numberOrZero(e.target.value) })}
							/>
						</Field>
						<Field label="Nonce 有效期(秒)">
							<TextField.Root
								type="number"
								value={config.nonce_ttl_seconds}
								onChange={e => setConfig({ ...config, nonce_ttl_seconds: numberOrZero(e.target.value) })}
							/>
						</Field>
						<Field label="Nonce 缓存容量">
							<TextField.Root
								type="number"
								value={config.nonce_cache_size}
								onChange={e => setConfig({ ...config, nonce_cache_size: numberOrZero(e.target.value) })}
							/>
						</Field>
						<Field label="要求来源匹配">
							<Switch checked={config.require_origin} onCheckedChange={v => setConfig({ ...config, require_origin: v })} />
							<Text size="1" color="gray">
								匹配 Origin/Referer 前缀
							</Text>
						</Field>
						<Field label="允许的 Origin(多条换行或逗号分隔)">
							<TextArea
								value={(config.allowed_origins || []).join('\n')}
								onChange={e => setConfig({ ...config, allowed_origins: e.target.value.split(/\n|,/).map(s => s.trim()) })}
							/>
						</Field>
						<Field label="允许的 Referer(可选)">
							<TextArea
								value={(config.allowed_referers || []).join('\n')}
								onChange={e => setConfig({ ...config, allowed_referers: e.target.value.split(/\n|,/).map(s => s.trim()) })}
							/>
						</Field>
					</Grid>
				</Flex>
			</Card>

			<Card>
				<Flex direction="column" gap="4" p="4">
					<Text size="4" weight="bold">
						频率限制
					</Text>
					<Grid columns={{ initial: '1', md: '3' }} gap="3">
						<Field label="公开节点查询/分钟 (0 关闭)">
							<TextField.Root
								type="number"
								value={config.rate_public_per_min}
								onChange={e => setConfig({ ...config, rate_public_per_min: numberOrZero(e.target.value) })}
							/>
						</Field>
						<Field label="授权校验/分钟 (0 关闭)">
							<TextField.Root
								type="number"
								value={config.rate_verify_per_min}
								onChange={e => setConfig({ ...config, rate_verify_per_min: numberOrZero(e.target.value) })}
							/>
						</Field>
						<Field label="开始测试/分钟 (0 关闭)">
							<TextField.Root
								type="number"
								value={config.rate_start_per_min}
								onChange={e => setConfig({ ...config, rate_start_per_min: numberOrZero(e.target.value) })}
							/>
						</Field>
					</Grid>
				</Flex>
			</Card>

			<Card>
				<Flex direction="column" gap="4" p="4">
					<Text size="4" weight="bold">
						失败封禁
					</Text>
					<Grid columns={{ initial: '1', md: '3' }} gap="3">
						<Field label="最大失败次数(0 关闭)">
							<TextField.Root
								type="number"
								value={config.max_failures_per_ip}
								onChange={e => setConfig({ ...config, max_failures_per_ip: numberOrZero(e.target.value) })}
							/>
						</Field>
						<Field label="失败统计窗口(秒)">
							<TextField.Root
								type="number"
								value={config.failure_window_seconds}
								onChange={e => setConfig({ ...config, failure_window_seconds: numberOrZero(e.target.value) })}
							/>
						</Field>
						<Field label="封禁时长(分钟)">
							<TextField.Root
								type="number"
								value={config.failure_lock_minutes}
								onChange={e => setConfig({ ...config, failure_lock_minutes: numberOrZero(e.target.value) })}
							/>
						</Field>
					</Grid>
					<Text size="1" color="gray">
						授权码错误、签名错误、来源非法时累加失败次数，达到阈值后封禁 IP。
					</Text>
				</Flex>
			</Card>
		</Flex>
	)
}

function Field({ label, children }: { label: string; children: ReactNode }) {
	return (
		<Flex direction="column" gap="1">
			<Text size="2" weight="medium">
				{label}
			</Text>
			{children}
		</Flex>
	)
}
