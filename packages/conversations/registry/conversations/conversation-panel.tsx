'use client'

import { resolveLabel, useChatPanel } from '@10x-media/conversations/react'
import { ArrowLeftIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { ConversationChannelTabs } from './conversation-channel-tabs'
import { ConversationComposer } from './conversation-composer'
import { ConversationFeed } from './conversation-feed'
import { ConversationThread } from './conversation-thread'
import { useConversationUI } from './conversation-ui'

export type ConversationPanelProps = {
	className?: string
	/** The conversation key, e.g. `collectionKey('tickets', id)`. */
	conversationKey: string
	/** Above the tabs, e.g. the ticket's subject. */
	header?: ReactNode
}

/**
 * One conversation, complete: channel tabs, the feed, the composer with the
 * channel's cue, and threads opening in place with a way back. Give it a
 * height; the feed scrolls inside. Needs a `ChatProvider` above it.
 */
export function ConversationPanel({ className, conversationKey, header }: ConversationPanelProps) {
	const { labels, locale } = useConversationUI()
	const panel = useChatPanel({ conversationKey })
	const { current, thread } = panel

	return (
		<div
			className={cn('flex min-h-0 flex-col overflow-hidden rounded-xl border bg-card', className)}
		>
			{header ? <div className="border-b px-4 py-3">{header}</div> : null}
			{thread && current ? (
				<>
					<div className="flex items-center gap-2 border-b px-2 py-1.5">
						<Button onClick={panel.closeThread} size="icon-sm" variant="ghost">
							<ArrowLeftIcon />
						</Button>
						<span className="font-medium text-sm">{labels.thread}</span>
						<span className="text-muted-foreground text-xs">
							{resolveLabel(current.label, locale)}
						</span>
					</div>
					<ConversationThread
						authors={panel.conversation.authors}
						channel={current}
						root={thread}
						viewer={panel.viewer}
					/>
				</>
			) : (
				<>
					<ConversationChannelTabs
						active={current?.slug ?? ''}
						channels={panel.channels}
						onChange={panel.setChannel}
						reads={panel.reads}
					/>
					{current ? (
						<>
							<ConversationFeed
								conversation={panel.conversation}
								key={`feed:${current.slug}`}
								onOpenThread={panel.openThread}
								readOnly={!current.canCreate}
							/>
							<div className="p-3 pt-0">
								<ConversationComposer
									channel={current.slug}
									conversationKey={conversationKey}
									cue={
										current.cue
											? { label: resolveLabel(current.cue.label, locale), tone: current.cue.tone }
											: null
									}
									cueAction={
										panel.other
											? {
													label: labels.switchTo(resolveLabel(panel.other.label, locale)),
													onClick: () => panel.setChannel(panel.other?.slug ?? ''),
												}
											: null
									}
									disabledReason={current.canCreate ? undefined : labels.readOnly}
									key={`composer:${current.slug}`}
								/>
							</div>
						</>
					) : panel.loading ? (
						<div className="flex-1 animate-pulse bg-muted/40" />
					) : null}
				</>
			)}
		</div>
	)
}
