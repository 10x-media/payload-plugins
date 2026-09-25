'use client'

import type { WindowMessage } from '@10x-media/conversations/react'
import { type ReactionSummary, useReactions } from '@10x-media/conversations/reactions/react'
import { SmilePlusIcon } from 'lucide-react'
import { useState } from 'react'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

const tooltip = (entry: ReactionSummary) => {
	const names = entry.users.map((user) => user.name).filter(Boolean)
	const more = entry.count - names.length
	return `${entry.emoji} ${names.join(', ')}${more > 0 ? ` +${more}` : ''}`
}

/** The allowed emoji as a row; picking toggles the viewer's reaction. */
export function ReactionRow({
	message,
	onPicked,
}: {
	message: WindowMessage
	onPicked?: () => void
}) {
	const reactions = useReactions()
	const mine = reactions.mine(message)
	if (reactions.emojis.length === 0) return null
	return (
		<div className="flex gap-0.5 p-1">
			{reactions.emojis.map((emoji) => (
				<button
					aria-pressed={mine.has(emoji)}
					className={cn(
						'flex size-8 items-center justify-center rounded-md text-lg hover:bg-muted disabled:opacity-40',
						mine.has(emoji) && 'bg-primary/10'
					)}
					disabled={reactions.isBlocked(message, emoji)}
					key={emoji}
					onClick={() => {
						onPicked?.()
						void reactions.toggle(message, emoji)
					}}
					type="button"
				>
					{emoji}
				</button>
			))}
		</div>
	)
}

/**
 * `messageFooter` slot: the reactions under a message, click to toggle your
 * own, and an add button. A deleted message keeps its reactions; only your
 * own can still be taken back.
 */
export function ReactionsBar({ message }: { message: WindowMessage }) {
	const reactions = useReactions()
	const [open, setOpen] = useState(false)
	const list = reactions.summaries(message)
	const deleted = Boolean(message.deletedAt)
	if (list.length === 0) return null
	return (
		<div className="mt-1 flex flex-wrap items-center gap-1">
			{list.map((entry) => (
				<button
					aria-pressed={entry.mine}
					className={cn(
						'flex h-6 items-center gap-1 rounded-full border px-2 text-xs hover:bg-muted disabled:opacity-50',
						entry.mine && 'border-primary/40 bg-primary/10'
					)}
					disabled={(deleted && !entry.mine) || reactions.isBlocked(message, entry.emoji)}
					key={entry.emoji}
					onClick={() => void reactions.toggle(message, entry.emoji)}
					title={tooltip(entry)}
					type="button"
				>
					<span>{entry.emoji}</span>
					<span className="tabular-nums">{entry.count}</span>
				</button>
			))}
			{deleted ? null : (
				<Popover onOpenChange={setOpen} open={open}>
					<PopoverTrigger
						render={
							<button
								aria-label="Add reaction"
								className="flex h-6 items-center rounded-full border px-1.5 text-muted-foreground hover:bg-muted"
								type="button"
							>
								<SmilePlusIcon className="size-3.5" />
							</button>
						}
					/>
					<PopoverContent align="start" className="w-auto p-0">
						<ReactionRow message={message} onPicked={() => setOpen(false)} />
					</PopoverContent>
				</Popover>
			)}
		</div>
	)
}

/** `messageQuickActions` slot: the emoji row at the top of a message's menu. */
export function ReactionQuickActions({
	close,
	message,
}: {
	close: () => void
	message: WindowMessage
}) {
	return (
		<div className="-mx-1 -mt-1 mb-1 border-b">
			<ReactionRow message={message} onPicked={close} />
		</div>
	)
}

/** Both slots, ready for `ConversationUIProvider`. */
export const reactionSlots = {
	messageFooter: [ReactionsBar],
	messageQuickActions: [ReactionQuickActions],
}
