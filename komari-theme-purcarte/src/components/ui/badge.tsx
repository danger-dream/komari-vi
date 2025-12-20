import * as React from 'react'
import { Badge as RadixBadge } from '@radix-ui/themes'
import { cn } from '@/utils'

type BadgeProps = React.ComponentProps<typeof RadixBadge>

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(({ className, children, ...props }, ref) => {
	return (
		<RadixBadge ref={ref} className={cn('rt-reset', className)} {...props}>
			{children}
		</RadixBadge>
	)
})

Badge.displayName = 'Badge'
