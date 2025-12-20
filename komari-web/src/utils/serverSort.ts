export type ServerOrderLike = {
	uuid?: string
	name?: string
	weight?: number | null
}

export function compareServersByWeightName(a: ServerOrderLike, b: ServerOrderLike) {
	const wa = typeof a.weight === 'number' && Number.isFinite(a.weight) ? a.weight : 0
	const wb = typeof b.weight === 'number' && Number.isFinite(b.weight) ? b.weight : 0
	if (wa !== wb) return wa - wb

	const nameA = (a.name ?? '').trim()
	const nameB = (b.name ?? '').trim()
	const nameCmp = nameA.localeCompare(nameB, undefined, { sensitivity: 'base' })
	if (nameCmp !== 0) return nameCmp

	const uuidA = (a.uuid ?? '').trim()
	const uuidB = (b.uuid ?? '').trim()
	return uuidA.localeCompare(uuidB, undefined, { sensitivity: 'base' })
}

