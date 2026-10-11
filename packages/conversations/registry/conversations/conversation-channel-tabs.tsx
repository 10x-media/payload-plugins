'use client'

import { type ChannelView, resolveLabel } from '@10x-media/conversations/react'
import { GlobeIcon, LockIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

import { useConversationUI } from './conversation-ui'

export type ConversationChannelTabsProps = {
	active: string
	channels: ChannelView[]
	className?: string
	onChange: (slug: string) => void
	/** False with `reads: false` on the server: no unread counts. */
	reads?: boolean
}

/** The readable channels as tabs, each with its unread count. Nothing with one channel. */
export function ConversationChannelTabs({
	active,
	channels,
	className,
	onChange,
	reads = true,
}: ConversationChannelTabsProps) {
	const { locale } = useConversationUI()
	if (channels.length < 2) return null
	return (
		<div className={cn('flex gap-1 border-b px-3', className)} role="tablist">
			{channels.map((channel) => {
				const selected = channel.slug === active
				const Icon = channel.cue?.tone === 'warning' ? GlobeIcon : LockIcon
				return (
					<button
						aria-selected={selected}
						className={cn(
							'-mb-px flex items-center gap-1.5 border-b-2 border-transparent px-2 py-2 text-muted-foreground text-sm hover:text-foreground',
							selected && 'border-primary text-foreground'
						)}
						key={channel.slug}
						onClick={() => onChange(channel.slug)}
						role="tab"
						type="button"
					>
						{channel.cue ? <Icon className="size-3.5" /> : null}
						{resolveLabel(channel.label, locale)}
						{reads && channel.unread > 0 && !selected ? (
							<span className="rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">
								{channel.unread > 99 ? '99+' : channel.unread}
							</span>
						) : null}
					</button>
				)
			})}
		</div>
	)
}
