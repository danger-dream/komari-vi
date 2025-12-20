import React from 'react'
import { Checkbox, TextField, ScrollArea, Text, Button, Flex } from '@radix-ui/themes'
import ServerViewModeControl, { type ServerViewMode } from '@/components/server/ServerViewModeControl'

/**
 * 通用多选列表组件：提供搜索、全选、半选（indeterminate）和孤立值渲染能力。
 * 通过传入任意 items，并提供 getId / getLabel 来定义唯一标识与显示内容。
 */
export interface SelectorProps<T> {
	className?: string
	hiddenDescription?: boolean
	/** 已选择的 id 列表 */
	value: string[]
	/** 选择变化回调 */
	onChange: (ids: string[]) => void
	/** 数据源 */
	items: T[]
	/** 获取唯一 id */
	getId: (item: T) => string
	/** 获取显示标签（单元格内容） */
	getLabel: (item: T) => React.ReactNode
	/** 自定义排序（可选） */
	sortItems?: (a: T, b: T) => number
	/** 自定义搜索过滤；返回 true 表示保留 */
	filterItem?: (item: T, keyword: string) => boolean
	/** 搜索占位符 */
	searchPlaceholder?: string
	/** 表头标题（第二列） */
	headerLabel?: React.ReactNode
	/** 表格区域的最大高度（仅表格滚动） */
	maxHeight?: string | number
	/** 根据返回值分组展示 */
	groupBy?: (item: T) => string | undefined
	/** 根据返回值按“地域”分组展示（与 groupBy 并存时可切换） */
	regionBy?: (item: T) => string | undefined
	/** 自定义未分组标签 */
	ungroupedLabel?: React.ReactNode
	/** 自定义未知地域标签 */
	unknownRegionLabel?: React.ReactNode
	/** 是否展示列表/分组切换 */
	viewModeSwitch?: boolean
	/** 切换的默认模式（仅 viewModeSwitch=true 时生效） */
	defaultViewMode?: ServerViewMode
	/** 切换按钮的标签 */
	viewModeLabels?: {
		list: React.ReactNode
		group: React.ReactNode
		region?: React.ReactNode
	}
}

function SelectorInner<T>(props: SelectorProps<T>) {
	const {
		className = '',
		hiddenDescription = false,
		value: externalValue,
		onChange,
		items,
		getId,
		getLabel,
		sortItems,
		filterItem,
		searchPlaceholder = 'Search…',
		maxHeight,
		groupBy,
		regionBy,
		ungroupedLabel,
		unknownRegionLabel,
		viewModeSwitch = false,
		defaultViewMode
	} = props

	const value = externalValue ?? []
	const [search, setSearch] = React.useState('')
	const supportedModes = React.useMemo(() => {
		const modes: ServerViewMode[] = ['list']
		if (groupBy) modes.push('group')
		if (regionBy) modes.push('region')
		return modes
	}, [groupBy, regionBy])

	const [viewMode, setViewMode] = React.useState<ServerViewMode>(() => {
		const initial = defaultViewMode ?? 'list'
		return supportedModes.includes(initial) ? initial : 'list'
	})

	React.useEffect(() => {
		if (!supportedModes.includes(viewMode)) setViewMode('list')
	}, [supportedModes, viewMode])
	const scrollStyle: React.CSSProperties | undefined = maxHeight
		? {
				maxHeight: typeof maxHeight === 'number' ? `${maxHeight}px` : maxHeight,
				minHeight: typeof maxHeight === 'number' ? `${maxHeight}px` : maxHeight, // 保持固定高度
				overflowY: 'auto' as const,
				overscrollBehavior: 'contain'
		  }
		: undefined

	// 排序 & 搜索
	const processed = React.useMemo(() => {
		let arr = [...items]
		if (sortItems) arr.sort(sortItems)
		if (search.trim()) {
			const kw = search.toLowerCase()
			arr = arr.filter(it => (filterItem ? filterItem(it, search) : String(getLabel(it)).toLowerCase().includes(kw)))
		}
		return arr
	}, [items, sortItems, filterItem, search, getLabel])

	const groupingFn = viewMode === 'group' ? groupBy : viewMode === 'region' ? regionBy : undefined
	const enableGroupView = !!groupingFn && (!viewModeSwitch || viewMode !== 'list')

	const allIds = processed.map(getId)
	const groupedItems = React.useMemo(() => {
		if (!enableGroupView) return [['', processed] as [string, T[]]]
		const map = new Map<string, T[]>()
		processed.forEach(item => {
			const key = groupingFn ? groupingFn(item) || '' : ''
			if (!map.has(key)) map.set(key, [])
			map.get(key)?.push(item)
		})
		const entries = Array.from(map.entries())
		entries.sort((a, b) => {
			const ga = a[0]
			const gb = b[0]
			const emptyA = !ga
			const emptyB = !gb
			if (emptyA && emptyB) return 0
			if (emptyA) return 1 // 空分组排最后
			if (emptyB) return -1
			return ga.localeCompare(gb, undefined, { sensitivity: 'base' })
		})
		return entries
	}, [processed, groupingFn, enableGroupView])

	// 半选逻辑
	const allChecked = allIds.length > 0 && allIds.every(id => value.includes(id))

	// 孤立（value 中但 items 不再存在）
	const orphanIds = value.filter(id => !items.some(it => getId(it) === id))

	const handleCheckAll = (checked: boolean) => {
		if (checked) {
			onChange(Array.from(new Set([...value, ...allIds])))
		} else {
			onChange(value.filter(id => !allIds.includes(id)))
		}
	}

	const handleCheck = (id: string, checked: boolean) => {
		if (checked) {
			onChange(Array.from(new Set([...value, id])))
		} else {
			onChange(value.filter(v => v !== id))
		}
	}

	return (
		<div className={`flex flex-col ${className}`}>
			{/* 顶部工具栏 */}
			<Flex justify="between" align="center" gap="2" className="mb-3">
				<Flex gap="2" align="center" className="flex-1">
					<Button size="1" variant="ghost" onClick={() => handleCheckAll(!allChecked)}>
						{allChecked ? '取消全选' : '全选'}
					</Button>
				</Flex>
				{viewModeSwitch && supportedModes.length > 1 && (
					<ServerViewModeControl value={viewMode} onValueChange={setViewMode} size="1" modes={supportedModes} />
				)}
			</Flex>

			{/* 搜索框 */}
			<TextField.Root
				placeholder={searchPlaceholder}
				value={search}
				onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
				size="2"
				className="mb-3"
			/>

			{/* 列表区域 */}
			<div className="overflow-hidden rounded-md border border-(--gray-6) bg-(--gray-2) shadow-[inset_0_1px_0_var(--gray-4)]" style={scrollStyle}>
				<ScrollArea type="auto" scrollbars="vertical" className="h-full">
					<div className="p-2">
						{enableGroupView ? (
							<div className="space-y-3">
								{groupedItems.map(([group, items]) => {
									const groupIds = items.map(getId)
									const groupAllChecked = groupIds.length > 0 && groupIds.every(id => value.includes(id))
									const groupIndeterminate = groupIds.length > 0 && groupIds.some(id => value.includes(id)) && !groupAllChecked

									const handleGroupToggle = (checked: boolean) => {
										if (checked) {
											onChange(Array.from(new Set([...value, ...groupIds])))
										} else {
											onChange(value.filter(id => !groupIds.includes(id)))
										}
									}

									return (
										<div key={group || 'ungrouped'}>
											{/* 分组标题 */}
											{(group ||
												(viewMode === 'region' ? unknownRegionLabel || ungroupedLabel : ungroupedLabel)) && (
												<Flex align="center" gap="2" className="px-2 py-1 mb-1">
													<Checkbox
														checked={groupIndeterminate ? 'indeterminate' : groupAllChecked}
														onCheckedChange={checked => handleGroupToggle(!!checked)}
													/>
													<Text size="2" weight="bold" className="text-(--gray-11)">
														{group || (viewMode === 'region' ? unknownRegionLabel || ungroupedLabel : ungroupedLabel)} ({items.length})
													</Text>
												</Flex>
											)}
											{/* 分组项目 */}
											<div className="space-y-0">
												{items.map(it => {
													const id = getId(it)
													return (
														<label
															key={id}
															className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-(--gray-3) transition-colors cursor-pointer">
															<Checkbox checked={value.includes(id)} onCheckedChange={checked => handleCheck(id, !!checked)} />
															<span className="text-sm truncate leading-tight flex-1">{getLabel(it)}</span>
														</label>
													)
												})}
											</div>
										</div>
									)
								})}
							</div>
						) : (
							<div className="space-y-0">
								{processed.map(it => {
									const id = getId(it)
									return (
										<label
											key={id}
											className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-(--gray-3) transition-colors cursor-pointer">
											<Checkbox checked={value.includes(id)} onCheckedChange={checked => handleCheck(id, !!checked)} />
											<span className="text-sm truncate leading-tight flex-1">{getLabel(it)}</span>
										</label>
									)
								})}
							</div>
						)}

						{/* 孤立项 */}
						{orphanIds.length > 0 && (
							<div className="mt-3 pt-3 border-t border-(--gray-6)">
								<Text size="1" color="gray" className="px-2 mb-1 block">
									已删除的项目
								</Text>
								{orphanIds.map(id => (
									<label
										key={id}
										className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-(--gray-3) transition-colors cursor-pointer">
										<Checkbox checked={value.includes(id)} onCheckedChange={checked => handleCheck(id, !!checked)} />
										<span className="text-sm truncate leading-tight text-(--gray-9)">{id}</span>
									</label>
								))}
							</div>
						)}

						{/* 无数据提示 */}
						{processed.length === 0 && orphanIds.length === 0 && (
							<div className="text-sm text-(--gray-9) text-center py-8">暂无数据</div>
						)}
					</div>
				</ScrollArea>
			</div>

			{/* 底部统计 */}
			{!hiddenDescription && (
				<div className="mt-2 text-gray-400 text-sm">
					已选择 {value.length} / {processed.length + orphanIds.length} 项
				</div>
			)}
		</div>
	)
}

/** 泛型组件导出 */
export function Selector<T>(props: SelectorProps<T>) {
	return <SelectorInner {...props} />
}

export default Selector
