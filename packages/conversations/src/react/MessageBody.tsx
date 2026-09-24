'use client'

import {
	type JSXConverters,
	type JSXConvertersFunction,
	RichText,
} from '@payloadcms/richtext-lexical/react'

import { MENTION_NODE_TYPE } from '../editor/mention/constants'
import type { AuthorsMap, ConversationMessage } from '../types'

export type MessageBodyProps = {
	authors?: AuthorsMap
	className?: string
	/** Extra or replacement converters, e.g. for nodes a custom editor feature adds. */
	converters?: JSXConverters
	message: Pick<ConversationMessage, 'body' | 'text'>
}

/**
 * A message body as React, through Lexical's JSX converters. Mentions read
 * their name from the live `authors` projection, so a renamed user shows the
 * new name; the name saved in the node is the fallback. No `@payloadcms/ui`
 * import: this renders on a website too.
 */
export const MessageBody = ({ authors, className, converters, message }: MessageBodyProps) => {
	if (!message.body) {
		return message.text ? <div className={className}>{message.text}</div> : null
	}
	const build: JSXConvertersFunction = ({ defaultConverters }) => ({
		...defaultConverters,
		[MENTION_NODE_TYPE]: ({ node }: { node: { label?: string; userKey?: string } }) => {
			const live = node.userKey ? authors?.[node.userKey] : undefined
			return (
				<span className="conversations-mention" data-user={node.userKey}>
					@{live && !live.deleted ? live.name : (node.label ?? '')}
				</span>
			)
		},
		...converters,
	})
	return (
		<RichText
			className={className}
			converters={build}
			data={message.body as Parameters<typeof RichText>[0]['data']}
			disableIndent
			disableTextAlign
		/>
	)
}
