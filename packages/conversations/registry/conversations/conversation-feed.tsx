'use client'

import {
	type FeedDay,
	type FeedItem,
	type UseConversationResult,
	useFeed,
	type WindowMessage,
} from '@10x-media/conversations/react'
import { ChevronDownIcon } from 'lucide-react'
import { Fragment, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { ConversationMessage } from './conversation-message'
import { useConversationUI } from './conversation-ui'

export type ConversationFeedProps = {
	className?: string
	conversation: UseConversationResult
	/** Shown when there are no messages. */
	empty?: ReactNode
	/** Rows from elsewhere, interleaved by time. */
	items?: FeedItem[]
	onOpenThread?: (message: WindowMessage) => void
	/** The channel takes no writes: messages offer no Edit or Delete. */
	readOnly?: boolean
}

/**
 * A scrolling feed or thread: opens at "New messages" or the bottom, keeps
 * your place while older pages load, follows the bottom while you are there,
 * and counts what arrives below otherwise. Give it a height (or a flex
 * parent); it scrolls inside.
 */
export function ConversationFeed({
	className,
	conversation,
	empty,
	items,
	onOpenThread,
	readOnly,
}: ConversationFeedProps) {
	const { labels, locale } = useConversationUI()
	const feed = useFeed({ conversation, items })

	const dayLabel = (day: FeedDay) =>
		day.relative === 'today'
			? labels.today
			: day.relative === 'yesterday'
				? labels.yesterday
				: new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(day.at))

	return (
		<div className={cn('relative flex min-h-0 flex-1 flex-col', className)}>
			<div
				className="min-h-0 flex-1 overflow-y-auto pb-2"
				onScroll={feed.onScroll}
				ref={feed.scrollerRef}
			>
				<div ref={feed.topRef} />
				{feed.hasOlder ? (
					<div className="flex justify-center py-2">
						<Button onClick={() => void feed.loadOlder()} size="xs" variant="ghost">
							{labels.loadEarlier}
						</Button>
					</div>
				) : null}
				{feed.skeleton ? (
					<div className="space-y-3 p-4">
						{[0, 1, 2].map((row) => (
							<div className="h-10 animate-pulse rounded-md bg-muted" key={row} />
						))}
					</div>
				) : null}
				{feed.status === 'error' ? (
					<div className="p-6 text-center text-muted-foreground text-sm">{labels.couldNotLoad}</div>
				) : null}
				{feed.status === 'ready' && !feed.skeleton && feed.rows.length === 0 ? (
					<div className="p-6 text-center text-muted-foreground text-sm">
						{empty ?? labels.empty}
					</div>
				) : null}
				{feed.rows.map((row) => (
					<Fragment key={row.key}>
						{row.day ? (
							<div className="my-2 flex items-center gap-3 px-4 text-muted-foreground text-xs">
								<div className="h-px flex-1 bg-border" />
								{dayLabel(row.day)}
								<div className="h-px flex-1 bg-border" />
							</div>
						) : null}
						{row.kind === 'item' ? (
							row.item.node
						) : (
							<>
								{row.divider ? (
									<div
										className="my-2 flex items-center gap-3 px-4 font-medium text-destructive text-xs"
										data-feed-divider=""
									>
										<div className="h-px flex-1 bg-destructive/40" />
										{labels.newMessages}
									</div>
								) : null}
								<ConversationMessage
									authors={conversation.authors}
									compact={row.compact}
									message={row.message}
									onOpenThread={onOpenThread}
									readOnly={readOnly}
									threadReadAt={conversation.threadReads[String(row.message.id)]}
									viewer={conversation.viewer}
								/>
							</>
						)}
					</Fragment>
				))}
				<div ref={feed.bottomRef} />
			</div>
			{feed.showJump ? (
				<div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
					<Button
						className="pointer-events-auto rounded-full shadow-md"
						onClick={() => void feed.toBottom()}
						size="sm"
						variant="secondary"
					>
						{feed.hasNewer ? labels.jumpToLatest : labels.unseen(feed.unseen)}
						<ChevronDownIcon />
					</Button>
				</div>
			) : null}
		</div>
	)
}
