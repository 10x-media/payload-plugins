'use client'

import { Button } from '@payloadcms/ui'
import { Fragment, type ReactNode } from 'react'

import type { FeedDay, FeedItem } from '../react/feed'
import type { UseConversationResult } from '../react/hooks'
import { useFeed } from '../react/useFeed'
import type { WindowMessage } from '../react/window'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { ChatMessage } from './ChatMessage'
import './conversations.css'

export type { FeedItem } from '../react/feed'

export type ChatFeedProps = {
	conversation: UseConversationResult
	/** Shown when the channel has no messages. */
	empty?: ReactNode
	instance: string
	/** Rows from elsewhere, interleaved by timestamp. */
	items?: FeedItem[]
	onOpenThread?: (message: WindowMessage) => void
	/** The channel takes no writes here, so messages offer no Edit or Delete. */
	readOnly?: boolean
	/** Replaces the default message renderer. */
	renderMessage?: (args: {
		compact: boolean
		message: WindowMessage
		conversation: UseConversationResult
	}) => ReactNode
	/** Renders messages whose `type` is not `text`. */
	renderType?: (message: WindowMessage) => ReactNode
}

/**
 * A scrolling window over a feed or thread, in the admin's look. The
 * behaviour (opening at the divider, keeping the place, "N new", paging) is
 * `useFeed`; this draws it.
 */
export const ChatFeed = ({
	conversation,
	empty,
	instance,
	items,
	onOpenThread,
	readOnly,
	renderMessage,
	renderType,
}: ChatFeedProps) => {
	const { i18n, t } = useTranslation()
	const feed = useFeed({ conversation, items })

	const dayLabel = (day: FeedDay) => {
		if (day.relative === 'today') return t(keys.today)
		if (day.relative === 'yesterday') return t(keys.yesterday)
		return new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(new Date(day.at))
	}

	return (
		<div className={`conversations-feed${feed.showJump ? ' conversations-feed--jump' : ''}`}>
			<div className="conversations-feed__scroller" onScroll={feed.onScroll} ref={feed.scrollerRef}>
				<div ref={feed.topRef} />
				{feed.hasOlder ? (
					<div className="conversations-feed__older">
						<Button
							buttonStyle="subtle"
							margin={false}
							onClick={() => void feed.loadOlder()}
							size="small"
						>
							{t(keys.loadEarlier)}
						</Button>
					</div>
				) : null}
				{feed.skeleton ? <div className="conversations-feed__skeleton" /> : null}
				{feed.status === 'error' ? (
					<div className="conversations-feed__empty">{t(keys.couldNotLoad)}</div>
				) : null}
				{feed.status === 'ready' && !feed.skeleton && feed.rows.length === 0 ? (
					<div className="conversations-feed__empty">{empty}</div>
				) : null}
				{feed.rows.map((row) => (
					<Fragment key={row.key}>
						{row.day ? <div className="conversations-feed__day">{dayLabel(row.day)}</div> : null}
						{row.kind === 'item' ? (
							row.item.node
						) : (
							<>
								{row.divider ? (
									<div className="conversations-feed__divider" data-feed-divider="">
										<span>{t(keys.newMessages)}</span>
									</div>
								) : null}
								{renderMessage ? (
									renderMessage({ compact: row.compact, conversation, message: row.message })
								) : (
									<ChatMessage
										authors={conversation.authors}
										compact={row.compact}
										instance={instance}
										message={row.message}
										onOpenThread={onOpenThread}
										readOnly={readOnly}
										renderType={renderType}
										threadReadAt={conversation.threadReads[String(row.message.id)]}
										viewer={conversation.viewer}
									/>
								)}
							</>
						)}
					</Fragment>
				))}
				{/* Reaching it loads the next page when the window is not at the end yet. */}
				<div ref={feed.bottomRef} />
			</div>
			{feed.showJump ? (
				<div className="conversations-feed__jump">
					<Button
						buttonStyle="pill"
						icon={['chevron']}
						iconPosition="right"
						margin={false}
						onClick={() => void feed.toBottom()}
						size="small"
					>
						{feed.hasNewer ? t(keys.jumpToLatest) : t(keys.unseenCount, { count: feed.unseen })}
					</Button>
				</div>
			) : null}
		</div>
	)
}
