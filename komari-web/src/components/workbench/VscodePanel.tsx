import type { ReactNode, MouseEvent } from 'react'
import clsx from 'clsx'
import { X } from 'lucide-react'
import { Badge } from '@radix-ui/themes'

interface VscodePanelProps {
	children: ReactNode
	className?: string
	isFlex?: boolean
}

export const VscodePanel = ({ children, className, isFlex = false }: VscodePanelProps) => {
	return (
		<div
			className={clsx(
				'bg-white dark:bg-vscode-bg text-gray-800 dark:text-vscode-foreground flex-shrink-0',
				{
					'flex flex-col': isFlex,
				},
				className
			)}>
			{children}
		</div>
	)
}

interface VscodePanelHeaderProps {
	children: ReactNode
	className?: string
	actions?: ReactNode
}

export const VscodePanelHeader = ({ children, className, actions }: VscodePanelHeaderProps) => {
	return (
		<div
			className={clsx(
				'flex items-center justify-between h-9 px-3 text-xs uppercase text-gray-500 dark:text-vscode-description-foreground border-b border-gray-200 dark:border-vscode-border',
				className
			)}>
			<span className="truncate">{children}</span>
			{actions && <div className="flex items-center gap-1">{actions}</div>}
		</div>
	)
}

interface VscodePanelContentProps {
	children: ReactNode
	className?: string
}

export const VscodePanelContent = ({ children, className }: VscodePanelContentProps) => {
	return <div className={clsx('flex-1 overflow-auto', className)}>{children}</div>
}

// VSCode-like button styling
interface VscodeButtonProps {
	children?: ReactNode
	onClick?: (event: MouseEvent<HTMLButtonElement>) => void
	className?: string
	icon?: ReactNode
	title?: string
	small?: boolean
	active?: boolean
	disabled?: boolean
}

export const VscodeButton = ({ children, onClick, className, icon, title, small = false, active = false, disabled = false }: VscodeButtonProps) => {
	return (
		<button
			onClick={onClick}
			title={title}
			disabled={disabled}
			className={clsx(
				'flex items-center justify-center gap-1.5 rounded',
				small ? 'h-7 px-2 text-xs' : 'h-8 px-3 text-sm',
				'transition-colors duration-150',
				'text-gray-600 hover:bg-gray-200 dark:text-vscode-foreground dark:hover:bg-vscode-button-hover-background',
				active && 'bg-gray-300 dark:bg-vscode-button-active-background',
				disabled && 'opacity-50 cursor-not-allowed',
				className
			)}>
			{icon && <span className={small ? 'w-4 h-4' : 'w-5 h-5'}>{icon}</span>}
			{children}
		</button>
	)
}

// VSCode-like Tab styling
interface VscodeTabProps {
	children: ReactNode
	onClick?: () => void
	onClose?: () => void
	active?: boolean
	dirty?: boolean
	className?: string
	type?: 'editor' | 'panel'
}

export const VscodeTab = ({ children, onClick, onClose, active, dirty, className, type = 'editor' }: VscodeTabProps) => {
	return (
		<div
			className={clsx(
				'flex items-center h-full px-4 text-sm cursor-pointer transition-colors duration-150',
				type === 'editor' &&
					clsx(
						'border-r border-gray-200 dark:border-vscode-border',
						active
							? 'bg-white dark:bg-vscode-tab-active-background text-gray-800 dark:text-vscode-tab-active-foreground'
							: 'bg-gray-100 dark:bg-vscode-tab-inactive-background text-gray-500 dark:text-vscode-tab-inactive-foreground hover:bg-gray-200 dark:hover:bg-vscode-bg-light hover:text-gray-800 dark:hover:text-vscode-tab-active-foreground'
					),
				type === 'panel' &&
					clsx(
						'border-b-2 -mb-px', // Use negative margin to pull the border up into the container's padding/border area
						active
							? 'text-gray-800 dark:text-vscode-panel-tab-active-foreground border-blue-500 dark:border-vscode-panel-tab-active-border'
							: 'text-gray-500 dark:text-vscode-panel-tab-inactive-foreground border-transparent hover:text-gray-800 dark:hover:text-vscode-panel-tab-active-foreground'
					),
				className
			)}
			onClick={onClick}>
			{type === 'editor' && dirty && <div className="w-2 h-2 rounded-full bg-current mr-2" />}
			<span className="truncate">{children}</span>
			{type === 'editor' && onClose && (
				<button
					className="ml-2 w-5 h-5 flex items-center justify-center rounded hover:bg-gray-300 dark:hover:bg-vscode-bg-light"
					onClick={e => {
						e.stopPropagation()
						onClose()
					}}
					title="Close">
					<X size={14} />
				</button>
			)}
		</div>
	)
}

interface VscodeTabsContainerProps {
	children: ReactNode
	actions?: ReactNode
	className?: string
}

export const VscodeTabsContainer = ({ children, actions, className }: VscodeTabsContainerProps) => {
	return (
		<div
			className={clsx(
				'flex items-center justify-between h-9 bg-gray-100 dark:bg-vscode-tabs-background border-b border-gray-200 dark:border-vscode-border',
				className
			)}>
			<div className="flex flex-1 overflow-x-auto custom-scrollbar-hidden">{children}</div>
			{actions && <div className="flex-shrink-0 px-2 flex items-center gap-1">{actions}</div>}
		</div>
	)
}

export const VscodeDivider = ({ className }: { className?: string }) => {
	return <div className={clsx('h-px bg-gray-200 dark:bg-vscode-border', className)} />
}

export const VscodeInput = ({ className, ...props }: React.ComponentPropsWithoutRef<'input'>) => {
	return (
		<input
			className={clsx(
				'w-full px-2 py-1 text-sm bg-white dark:bg-vscode-input-background border border-gray-300 dark:border-vscode-input-border rounded',
				'text-gray-800 dark:text-vscode-input-foreground placeholder-gray-400 dark:placeholder-vscode-input-placeholder-foreground',
				'focus:outline-none focus:ring-1 focus:ring-blue-500 dark:focus:ring-vscode-input-focus-border',
				className
			)}
			{...props}
		/>
	)
}

export const VscodeTextArea = ({ className, ...props }: React.ComponentPropsWithoutRef<'textarea'>) => {
	return (
		<textarea
			className={clsx(
				'w-full px-2 py-1 text-sm bg-white dark:bg-vscode-input-background border border-gray-300 dark:border-vscode-input-border rounded',
				'text-gray-800 dark:text-vscode-input-foreground placeholder-gray-400 dark:placeholder-vscode-input-placeholder-foreground',
				'focus:outline-none focus:ring-1 focus:ring-blue-500 dark:focus:ring-vscode-input-focus-border',
				className
			)}
			{...props}
		/>
	)
}

export const VscodeSelect = ({ className, ...props }: React.ComponentPropsWithoutRef<'select'>) => {
	return (
		<select
			className={clsx(
				'w-full px-2 py-1 text-sm bg-white dark:bg-vscode-input-background border border-gray-300 dark:border-vscode-input-border rounded',
				'text-gray-800 dark:text-vscode-input-foreground',
				'focus:outline-none focus:ring-1 focus:ring-blue-500 dark:focus:ring-vscode-input-focus-border',
				className
			)}
			{...props}
		/>
	)
}

// This component is not used in the final version, but kept for reference
// VSCode-like styling for Radix UI Badge
interface VscodeBadgeProps extends React.ComponentPropsWithoutRef<typeof Badge> {
	children: ReactNode
	color?: 'green' | 'red' | 'yellow' | 'blue' | 'gray'
	variant?: 'solid' | 'soft'
	className?: string
}

export const VscodeBadge = ({ children, color = 'gray', variant = 'soft', className, ...props }: VscodeBadgeProps) => {
	const baseStyles = 'rounded-sm px-1 py-0.5 text-xs font-mono inline-flex items-center justify-center'
	const colorStyles = {
		green: {
			solid: 'bg-green-600 text-white dark:bg-vscode-badge-green-bg dark:text-vscode-badge-green-fg',
			soft: 'bg-green-100 text-green-800 dark:bg-vscode-badge-green-soft-bg dark:text-vscode-badge-green-soft-fg',
		},
		red: {
			solid: 'bg-red-600 text-white dark:bg-vscode-badge-red-bg dark:text-vscode-badge-red-fg',
			soft: 'bg-red-100 text-red-800 dark:bg-vscode-badge-red-soft-bg dark:text-vscode-badge-red-soft-fg',
		},
		yellow: {
			solid: 'bg-yellow-500 text-white dark:bg-vscode-badge-yellow-bg dark:text-vscode-badge-yellow-fg',
			soft: 'bg-yellow-100 text-yellow-800 dark:bg-vscode-badge-yellow-soft-bg dark:text-vscode-badge-yellow-soft-fg',
		},
		blue: {
			solid: 'bg-blue-600 text-white dark:bg-vscode-badge-blue-bg dark:text-vscode-badge-blue-fg',
			soft: 'bg-blue-100 text-blue-800 dark:bg-vscode-badge-blue-soft-bg dark:text-vscode-badge-blue-soft-fg',
		},
		gray: {
			solid: 'bg-gray-500 text-white dark:bg-vscode-badge-gray-bg dark:text-vscode-badge-gray-fg',
			soft: 'bg-gray-200 text-gray-800 dark:bg-vscode-badge-gray-soft-bg dark:text-vscode-badge-gray-soft-fg',
		},
	}

	return (
		<Badge className={clsx(baseStyles, colorStyles[color][variant], className)} {...props}>
			{children}
		</Badge>
	)
}