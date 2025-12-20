import type { ScriptFolder, ScriptItem, TreeFolder, VariableItem } from '@/components/workbench/types'

export const buildTree = (folders: ScriptFolder[], scripts: ScriptItem[]) => {
	const folderMap = new Map<number, TreeFolder>()
	const rootFolder: ScriptFolder = { id: 0, name: '未分组', parent_id: null, order: 0 }
	folderMap.set(0, { folder: rootFolder, scripts: [], children: [] })
	folders.forEach(f => {
		folderMap.set(f.id, { folder: f, scripts: [], children: [] })
	})
	folders.forEach(f => {
		const parentId = f.parent_id ?? 0
		const parentNode = folderMap.get(parentId) || folderMap.get(0)!
		parentNode.children.push(folderMap.get(f.id)!)
	})
	scripts.forEach(s => {
		const folderId = s.folder_id ?? 0
		const target = folderMap.get(folderId) || folderMap.get(0)!
		target.scripts.push(s)
	})
	return [folderMap.get(0)!]
}

export const guessValueType = (raw: string) => {
	try {
		const parsed = JSON.parse(raw)
		if (Array.isArray(parsed)) return 'array'
		if (parsed === null) return 'null'
		switch (typeof parsed) {
			case 'string':
				return 'string'
			case 'number':
				return 'number'
			case 'boolean':
				return 'boolean'
			case 'object':
				return 'object'
			default:
				return 'unknown'
		}
	} catch {
		return 'string'
	}
}

export const statusColor = (status?: string) => {
	switch (status) {
		case 'success':
			return 'green'
		case 'failed':
			return 'red'
		case 'timeout':
			return 'yellow'
		default:
			return 'gray'
	}
}

export const nilToNull = (v?: number | null) => (v === undefined || v === null ? null : v)
