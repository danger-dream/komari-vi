import type { NodeDetail } from '@/contexts/NodeDetailsContext'

export type TaskProbeType = 'icmp' | 'tcp' | 'http'

export const getPreferredNodeIP = (node: Pick<NodeDetail, 'ipv4' | 'ipv6'>): string => {
	const ipv4 = String(node.ipv4 ?? '').trim()
	if (ipv4) return ipv4
	const ipv6 = String(node.ipv6 ?? '').trim()
	if (ipv6) return ipv6
	return ''
}

export const wrapIPv6Host = (host: string): string => {
	const trimmed = host.trim()
	if (!trimmed) return trimmed
	if (trimmed.startsWith('[') && trimmed.includes(']')) return trimmed
	// 仅对 IPv6 字面量做 [] 包裹，避免误处理域名（域名中一般不包含冒号）
	if (trimmed.includes(':') && !trimmed.includes('.')) return `[${trimmed}]`
	return trimmed
}

export const buildDefaultTarget = (ip: string, type: TaskProbeType): string => {
	const host = wrapIPv6Host(ip)
	if (!host) return ''
	if (type === 'icmp') return ip.trim()
	if (type === 'tcp') return `${host}:22`
	// http
	return `http://${host}:80`
}

export const normalizeGroupKey = (group: string | undefined | null): string => (group && group.trim() ? group.trim() : '__ungrouped__')

const ipv4Pattern = /^(?:\d{1,3}\.){3}\d{1,3}$/

const maskIpv4 = (ip: string): string => {
	const parts = ip.split('.')
	if (parts.length !== 4) return ip
	return `${parts[0]}.${parts[1]}.*.*`
}

const maskIpv6 = (ip: string): string => {
	const parts = ip.split(':').filter(Boolean)
	if (parts.length <= 2) return ip
	return `${parts.slice(0, 2).join(':')}:****:${parts[parts.length - 1]}`
}

const maskDomainLabel = (label: string): string => {
	if (label.length <= 1) return '*'
	if (label.length === 2) return `${label[0]}*`
	return `${label[0]}${'*'.repeat(label.length - 2)}${label[label.length - 1]}`
}

const maskDomain = (host: string): string => {
	const labels = host.split('.').filter(Boolean)
	if (labels.length === 0) return host
	const lastIndex = labels.length - 1
	return labels
		.map((label, index) => {
			if (index === lastIndex) return label
			return maskDomainLabel(label)
		})
		.join('.')
}

const maskHost = (host: string): string => {
	const unwrapped = host.replace(/^\[|\]$/g, '')
	if (ipv4Pattern.test(unwrapped)) return maskIpv4(unwrapped)
	if (unwrapped.includes(':')) return maskIpv6(unwrapped)
	return maskDomain(unwrapped)
}

const maskPort = (): string => '****'

export const maskTarget = (target: string): string => {
	const trimmed = target.trim()
	if (!trimmed) return trimmed

	if (trimmed.includes('://')) {
		try {
			const url = new URL(trimmed)
			const maskedHost = maskHost(url.hostname)
			const wrappedHost = wrapIPv6Host(maskedHost)
			const auth = url.username || url.password ? `${url.username}${url.password ? `:${url.password}` : ''}@` : ''
			const portPart = url.port ? `:${maskPort()}` : ''
			return `${url.protocol}//${auth}${wrappedHost}${portPart}${url.pathname}${url.search}${url.hash}`
		} catch {
			// Fall through to plain target handling.
		}
	}

	const bracketMatch = trimmed.match(/^\[(.+)\]:(\d+)$/)
	if (bracketMatch) {
		return `[${maskHost(bracketMatch[1])}]:${maskPort()}`
	}

	const lastColonIndex = trimmed.lastIndexOf(':')
	if (lastColonIndex > 0 && trimmed.indexOf(':') === lastColonIndex) {
		const hostPart = trimmed.slice(0, lastColonIndex)
		const portPart = trimmed.slice(lastColonIndex + 1)
		if (/^\d+$/.test(portPart)) {
			return `${maskHost(hostPart)}:${maskPort()}`
		}
	}

	return maskHost(trimmed)
}
