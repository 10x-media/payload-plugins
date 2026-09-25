'use client'

import { ChatPanel, ChatRichTextProvider } from '@10x-media/conversations/client'
import { ChatScope, collectionKey } from '@10x-media/conversations/react'
import { useDocumentInfo } from '@payloadcms/ui'

import { textColorConverters, withTextColor } from '../features/textColor'
import './ticket-conversation.css'

/**
 * Project code, not the plugin's: a ticket's conversation right in its edit
 * form, composed from the plugin's `ChatPanel` (tabs, feed, composer, threads
 * in a drawer). Registered as a `ui` field on `tickets`.
 */
export const TicketConversation = () => {
	const { id } = useDocumentInfo()
	if (id === undefined || id === null) {
		return <p className="ticket-conversation__empty">Save the ticket to start the conversation.</p>
	}
	const key = collectionKey('tickets', id)
	return (
		<ChatScope instance="tickets">
			<ChatRichTextProvider composerFeatures={withTextColor} converters={textColorConverters}>
				<div className="conversations-inline">
					<ChatPanel
						conversationKey={key}
						instance="tickets"
						threadSlug={`ticket-${String(id)}-thread`}
					/>
				</div>
			</ChatRichTextProvider>
		</ChatScope>
	)
}
