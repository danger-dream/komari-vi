import { formatBytes, formatTrafficLimit, formatUptime } from '@/utils'
import type { NodeWithStatus } from '@/types/node'
import { Link } from 'react-router-dom'
import { CpuIcon, MemoryStickIcon, HardDriveIcon } from 'lucide-react'
import Flag from './Flag'
import { Tag } from '../ui/tag'
import { useNodeCommons } from '@/hooks/useNodeCommons'
import { CircleProgress } from '../ui/progress-circle'
import { ProgressBar } from '../ui/progress-bar'

interface NodeListItemProps {
	node: NodeWithStatus
	enableSwap: boolean
	enableListItemProgressBar: boolean
	selectTrafficProgressStyle: 'circular' | 'linear'
}

export const NodeListItem = ({ node, enableSwap, enableListItemProgressBar, selectTrafficProgressStyle }: NodeListItemProps) => {
	const { stats, isOnline, tagList, cpuUsage, memUsage, swapUsage, diskUsage, load, expired_at, trafficPercentage } = useNodeCommons(node)

	const gridCols = enableSwap ? 'grid-cols-10' : 'grid-cols-9'

	return (
		<div
			className={`grid ${gridCols} text-center shadow-sm shadow-(color:--accent-4)/50 gap-4 p-2 text-nowrap items-center rounded-lg ${
				isOnline ? '' : 'striped-bg-red-translucent-diagonal ring-2 ring-red-500/50'
			} text-secondary-foreground transition-colors duration-200`}>
			<div className="col-span-2 flex items-center text-left">
				<Flag flag={node.region} />
				<Link to={`/instance/${node.uuid}`}>
					<div className="ml-2 w-full">
						<div className="text-base font-bold">{node.name}</div>
						<Tag className="text-xs" tags={tagList} />
						<div className="flex text-xs">
							<span className="text-secondary-foreground">到期：{expired_at}</span>
						</div>
						<div className="flex text-xs">
							<span className="text-secondary-foreground">{isOnline && stats ? `在线：${formatUptime(stats.uptime)}` : '离线'}</span>
						</div>
					</div>
				</Link>
			</div>
			<div className="col-span-1 flex items-center text-left">
				<CpuIcon className="inline-block size-5 flex-shrink-0 text-(--accent-11)" />
				<div className="ml-1 w-full items-center justify-center">
					<div>{node.cpu_cores} Cores</div>
					{enableListItemProgressBar ? (
						<div className="flex items-center gap-1">
							<ProgressBar value={cpuUsage} h="h-2" />
							<span className="w-10 text-right text-xs">{isOnline ? `${cpuUsage.toFixed(0)}%` : 'N/A'}</span>
						</div>
					) : (
						<div>{isOnline ? `${cpuUsage.toFixed(0)}%` : 'N/A'}</div>
					)}
				</div>
			</div>
			<div className="col-span-1 flex items-center text-left">
				<MemoryStickIcon className="inline-block size-5 flex-shrink-0 text-(--accent-11)" />
				<div className="ml-1 w-full items-center justify-center">
					<div>{formatBytes(node.mem_total)}</div>
					{enableListItemProgressBar ? (
						<div className="flex items-center gap-1">
							<ProgressBar value={memUsage} h="h-2" />
							<span className="w-10 text-right text-xs">{isOnline ? `${memUsage.toFixed(0)}%` : 'N/A'}</span>
						</div>
					) : (
						<div>{isOnline ? `${memUsage.toFixed(0)}%` : 'N/A'}</div>
					)}
				</div>
			</div>
			{enableSwap && (
				<div className="col-span-1 flex items-center text-left">
					<MemoryStickIcon className="inline-block size-5 flex-shrink-0 text-(--accent-11)" />
					{node.swap_total > 0 ? (
						<div className="ml-1 w-full items-center justify-center">
							<div>{formatBytes(node.swap_total)}</div>
							{enableListItemProgressBar ? (
								<div className="flex items-center gap-1">
									<ProgressBar value={swapUsage} h="h-2" />
									<span className="w-10 text-right text-xs">{isOnline ? `${swapUsage.toFixed(0)}%` : 'N/A'}</span>
								</div>
							) : (
								<div>{isOnline ? `${swapUsage.toFixed(0)}%` : 'N/A'}</div>
							)}
						</div>
					) : (
						<div className="ml-1 w-full item-center justify-center">OFF</div>
					)}
				</div>
			)}
			<div className="col-span-1 flex items-center text-left">
				<HardDriveIcon className="inline-block size-5 flex-shrink-0 text-(--accent-11)" />
				<div className="ml-1 w-full items-center justify-center">
					<div>{formatBytes(node.disk_total)}</div>
					{enableListItemProgressBar ? (
						<div className="flex items-center gap-1">
							<ProgressBar value={diskUsage} h="h-2" />
							<span className="w-10 text-right text-xs">{isOnline ? `${diskUsage.toFixed(0)}%` : 'N/A'}</span>
						</div>
					) : (
						<div>{isOnline ? `${diskUsage.toFixed(0)}%` : 'N/A'}</div>
					)}
				</div>
			</div>
			<div className="col-span-1">
				<div>↑ {stats ? formatBytes(stats.network.up, true) : 'N/A'}</div>
				<div>↓ {stats ? formatBytes(stats.network.down, true) : 'N/A'}</div>
			</div>
			<div className="col-span-2">
				{selectTrafficProgressStyle === 'linear' && isOnline && stats ? (
					<div className="flex flex-col items-center">
						<div className="w-full flex justify-center items-center">
							<span>{stats ? `↑ ${formatBytes(stats.network.totalUp)} ↓ ${formatBytes(stats.network.totalDown)}` : 'N/A'}</span>
						</div>
						{node.traffic_limit !== 0 && isOnline && stats && (
							<>
								<div className="w-[80%] flex items-center gap-1 mt-1">
									<ProgressBar value={trafficPercentage} h="h-2" />
									<span className="text-right text-xs">{node.traffic_limit !== 0 ? `${trafficPercentage.toFixed(0)}%` : 'OFF'}</span>
								</div>
								<div className="text-xs text-secondary-foreground mt-1">{formatTrafficLimit(node.traffic_limit, node.traffic_limit_type)}</div>
							</>
						)}
					</div>
				) : (
					<div className="flex items-center justify-around">
						{node.traffic_limit !== 0 && isOnline && stats && (
							<div className="flex items-center justify-center w-1/3">
								<CircleProgress value={trafficPercentage} maxValue={100} size={32} strokeWidth={4} showPercentage={true} />
							</div>
						)}
						<div className={node.traffic_limit !== 0 ? 'w-2/3 text-left' : 'w-full'}>
							<div>
								<div>↑ {stats ? formatBytes(stats.network.totalUp) : 'N/A'}</div>
								<div>↓ {stats ? formatBytes(stats.network.totalDown) : 'N/A'}</div>
							</div>
							{node.traffic_limit !== 0 && isOnline && stats && <div>{formatTrafficLimit(node.traffic_limit, node.traffic_limit_type)}</div>}
						</div>
					</div>
				)}
			</div>
			<div className="col-span-1">
				{load.split('|').map((item, index) => (
					<div key={index}>{item.trim()}</div>
				))}
			</div>
		</div>
	)
}
