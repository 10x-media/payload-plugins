'use client'

import type { ReactNode } from 'react'

import type { ChannelView } from '../react/hooks'
import { useThread } from '../react/useThread'
import type { WindowMessage } from '../react/window'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import type { AuthorsMap } from '../types'
import { ChatComposer } from './ChatComposer'
import { ChatFeed } from './ChatFeed'
import { ChatMessage } from './ChatMessage'

export type ChatThreadProps = {
	authors: AuthorsMap
	channel: ChannelView
	instance: string
	renderType?: (message: WindowMessage) => ReactNode
	root: WindowMessage
	viewer: null | string
}

/** A root message, its replies as their own window, and a reply composer. */
export const ChatThread = ({
	authors,
	channel,
	instance,
	renderType,
	root,
	viewer,
}: ChatThreadProps) => {
	const { t } = useTranslation()
	const conversation = useThread({ authors, root })
	return (
		<div className="conversations-thread">
			<div className="conversations-thread__root">
				<ChatMessage
					authors={conversation.authors}
					instance={instance}
					message={root}
					readOnly={!channel.canCreate}
					renderType={renderType}
					viewer={viewer}
				/>
			</div>
			<ChatFeed
				conversation={conversation}
				instance={instance}
				readOnly={!channel.canCreate}
				renderType={renderType}
			/>
			<ChatComposer
				channel={root.channel}
				conversationKey={root.key}
				cue={{ label: t(keys.replyingInThread), tone: 'neutral' }}
				disabledReason={channel.canCreate ? undefined : t(keys.readOnlyChannel)}
				instance={instance}
				parent={String(root.id)}
				placeholder={t(keys.replyInThread)}
			/>
		</div>
	)
}
