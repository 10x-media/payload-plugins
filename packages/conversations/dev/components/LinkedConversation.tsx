'use client'

import { ChatDrawer } from '@10x-media/conversations/client'
import { ChatScope } from '@10x-media/conversations/react'
import { useModal, useSearchParams } from '@payloadcms/ui'
import { type ReactNode, useEffect } from 'react'

const DRAWER_SLUG = 'linked-conversation'

/**
 * Project code, not the plugin's: what a notification link opens. On any
 * admin page, `?conversation=<key>` opens that conversation of the `comments`
 * instance in one drawer, on `&channel=<slug>` or at `&message=<id>`. Added
 * as an admin provider after the conversations plugins, so the chat store is
 * above it.
 */
export const LinkedConversation = ({ children }: { children?: ReactNode }) => {
	const params = useSearchParams()
	const conversationKey = params.get('conversation')
	const channel = params.get('channel')
	const message = params.get('message')
	const { openModal } = useModal()

	useEffect(() => {
		if (conversationKey) openModal(DRAWER_SLUG)
	}, [channel, conversationKey, message, openModal])

	return (
		<>
			{children}
			{conversationKey ? (
				<ChatScope instance="comments">
					<ChatDrawer
						channel={channel}
						conversationKey={conversationKey}
						drawerSlug={DRAWER_SLUG}
						instance="comments"
						message={message}
						subtitle="Opened from a link"
					/>
				</ChatScope>
			) : null}
		</>
	)
}
