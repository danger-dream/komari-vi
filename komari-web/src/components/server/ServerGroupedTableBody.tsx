import React from 'react'
import { TableCell, TableRow } from '@/components/ui/table'
import type { ServerViewMode } from './ServerViewModeControl'
import { compareServersByWeightName } from '@/utils/serverSort'

type ServerLike = {
	uuid: string
	name: string
	weight?: number
	group?: string
	region?: string
}

const sortGroupKeys = (a: string, b: string) => {
	const emptyA = !a
	const emptyB = !b
	if (emptyA && emptyB) return 0
	if (emptyA) return 1
	if (emptyB) return -1
	return a.localeCompare(b, undefined, { sensitivity: 'base' })
}

export const ServerGroupedTableBody = <T extends ServerLike>({
	items,
	viewMode,
	colSpan,
	renderRow,
	getGroupKey,
	getRegionKey,
	ungroupedLabel,
	unknownRegionLabel,
	sortItems
}: {
	items: T[]
	viewMode: ServerViewMode
	colSpan: number
	renderRow: (item: T) => React.ReactNode
	getGroupKey?: (item: T) => string
	getRegionKey?: (item: T) => string
	ungroupedLabel?: React.ReactNode
	unknownRegionLabel?: React.ReactNode
	sortItems?: (a: T, b: T) => number
}) => {
	const sorted = React.useMemo(() => {
		const arr = [...items]
		arr.sort(sortItems ?? compareServersByWeightName)
		return arr
	}, [items, sortItems])

	const sections = React.useMemo(() => {
		if (viewMode === 'list') return [{ key: '', label: '', items: sorted }]

		const getKey =
			viewMode === 'group'
				? (it: T) => (getGroupKey ? getGroupKey(it) : it.group?.trim() || '')
				: (it: T) => (getRegionKey ? getRegionKey(it) : it.region?.trim() || '')

		const map = new Map<string, T[]>()
		sorted.forEach(it => {
			const k = (getKey(it) || '').trim()
			if (!map.has(k)) map.set(k, [])
			map.get(k)!.push(it)
		})

		const entries = Array.from(map.entries()).sort((a, b) => sortGroupKeys(a[0], b[0]))

		return entries.map(([key, groupItems]) => ({
			key,
			label:
				key ||
				(viewMode === 'group' ? ungroupedLabel || '未分组' : unknownRegionLabel || ungroupedLabel || '未知地域'),
			items: groupItems
		}))
	}, [sorted, viewMode, getGroupKey, getRegionKey, ungroupedLabel, unknownRegionLabel])

	if (viewMode === 'list') {
		return <>{sections[0].items.map(it => renderRow(it))}</>
	}

	return (
		<>
			{sections.map(section => (
				<React.Fragment key={section.key || 'ungrouped'}>
					<TableRow className="bg-accent-3">
						<TableCell colSpan={colSpan} className="text-xs font-medium text-accent-11 uppercase tracking-wide">
							{section.label} ({section.items.length})
						</TableCell>
					</TableRow>
					{section.items.map(it => renderRow(it))}
				</React.Fragment>
			))}
		</>
	)
}

export default ServerGroupedTableBody
