'use client'

import {
	type AuthorsMap,
	type ChannelView,
	useThread,
	type WindowMessage,
} from '@10x-media/conversations/react'

import { ConversationComposer } from './conversation-composer'
import { ConversationFeed } from './conversation-feed'
import { ConversationMessage } from './conversation-message'
import { useConversationUI } from './conversation-ui'

export type ConversationThreadProps = {
	/** The authors the root's feed already knows. */
	authors: AuthorsMap
	channel: ChannelView
	root: WindowMessage
	viewer: null | string
}

/** A thread: its root message, the replies as their own feed, and a reply composer. */
export function ConversationThread({ authors, channel, root, viewer }: ConversationThreadProps) {
	const { labels } = useConversationUI()
	const conversation = useThread({ authors, root })
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="border-b pb-2">
				<ConversationMessage
					authors={conversation.authors}
					message={root}
					readOnly={!channel.canCreate}
					viewer={viewer}
				/>
			</div>
			<ConversationFeed conversation={conversation} readOnly={!channel.canCreate} />
			<div className="p-3 pt-0">
				<ConversationComposer
					channel={root.channel}
					conversationKey={root.key}
					disabledReason={channel.canCreate ? undefined : labels.readOnly}
					parent={String(root.id)}
					placeholder={labels.replyPlaceholder}
				/>
			</div>
		</div>
	)
}
