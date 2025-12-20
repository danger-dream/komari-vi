import React, { useState, useRef, useEffect } from 'react'
import { Info } from 'lucide-react'
import { Popover, Dialog } from '@radix-ui/themes'
import { useIsMobile } from '@/hooks/useMobile'

interface TipsProps {
	size?: string
	color?: string
	children?: React.ReactNode
	trigger?: React.ReactNode
	mode?: 'popup' | 'dialog' | 'auto'
	side?: 'top' | 'right' | 'bottom' | 'left'
	contentMinWidth?: string
	contentMaxWidth?: string
	openDelayMs?: number
	closeDelayMs?: number
}

const Tips: React.FC<TipsProps & React.HTMLAttributes<HTMLDivElement>> = ({
	size = '16',
	color = 'var(--theme-text-muted-color)',
	trigger,
	children,
	side = 'bottom',
	mode = 'popup',
	contentMinWidth,
	contentMaxWidth,
	openDelayMs = 80,
	closeDelayMs = 240,
	...props
}) => {
	const [isOpen, setIsOpen] = useState(false)
	const isMobile = useIsMobile()

	// determine whether to render a Dialog instead of a Popover
	const isDialog = mode === 'dialog' || (mode === 'auto' && isMobile)

	const openTimer = useRef<number | null>(null)
	const closeTimer = useRef<number | null>(null)

	const clearTimers = () => {
		if (openTimer.current) {
			window.clearTimeout(openTimer.current)
			openTimer.current = null
		}
		if (closeTimer.current) {
			window.clearTimeout(closeTimer.current)
			closeTimer.current = null
		}
	}

	useEffect(() => {
		return () => clearTimers()
	}, [])

	const scheduleOpen = () => {
		clearTimers()
		openTimer.current = window.setTimeout(() => setIsOpen(true), openDelayMs)
	}

	const scheduleClose = () => {
		clearTimers()
		closeTimer.current = window.setTimeout(() => setIsOpen(false), closeDelayMs)
	}

	const handleInteraction = () => {
		// 无论是否为移动端，点击都可切换开关，便于固定以复制内容
		setIsOpen(prev => !prev)
	}

	return (
		<div className="relative inline-block" {...props}>
			{isDialog ? (
				<Dialog.Root open={isOpen} onOpenChange={setIsOpen}>
					<Dialog.Trigger>
						<div className={`flex items-center justify-center rounded-full font-bold cursor-pointer `} onClick={handleInteraction}>
							{trigger ?? <Info color={color} size={size} />}
						</div>
					</Dialog.Trigger>
					<Dialog.Content>
						<div className="flex flex-col gap-2">
							{/* <label className="text-xl font-bold">Tips</label> */}
							<div>{children}</div>
						</div>
					</Dialog.Content>
				</Dialog.Root>
			) : (
				<Popover.Root open={isOpen} onOpenChange={setIsOpen}>
					<Popover.Trigger>
						<div
							className={`flex items-center justify-center rounded-full font-bold cursor-pointer `}
							onClick={handleInteraction}
							onMouseEnter={!isMobile ? scheduleOpen : undefined}
							onMouseLeave={!isMobile ? scheduleClose : undefined}
						>
							{trigger ?? <Info color={color} size={size} />}
						</div>
					</Popover.Trigger>
					<Popover.Content
						side={side}
						sideOffset={5}
						onMouseEnter={!isMobile ? scheduleOpen : undefined}
						onMouseLeave={!isMobile ? scheduleClose : undefined}
						className="purcarte-blur theme-card-style z-50"
						style={{
							minWidth: contentMinWidth ?? (isMobile ? '12rem' : '20rem'),
							maxWidth: contentMaxWidth ?? (isMobile ? '85vw' : '28rem'),
							backgroundColor: 'var(--card)'
						}}
					>
						<div className="relative text-sm text-secondary-foreground">{children}</div>
					</Popover.Content>
				</Popover.Root>
			)}
		</div>
	)
}

export default Tips
