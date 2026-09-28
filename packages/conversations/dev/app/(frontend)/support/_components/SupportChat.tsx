'use client'

import {
	ChatProvider,
	type ClientTransportSpec,
	collectionKey,
	transportFromSpec,
} from '@10x-media/conversations/react'
import { useState } from 'react'

import { attachmentSlots } from '../../../../../registry/attachments/conversation-attachments'
import { ConversationPanel } from '../../../../../registry/conversations/conversation-panel'
import { ConversationUIProvider } from '../../../../../registry/conversations/conversation-ui'
import { reactionSlots } from '../../../../../registry/reactions/conversation-reactions'
import { textColorConverters, withTextColor } from '../../../../features/textColor'

/**
 * A ticket's conversation on the website, from the registry components. The
 * server hands down which transport the instance uses (Pusher here).
 */
/** Both extensions' slots; `messageFooter` shows the files, then the reactions. */
const slots = {
	...attachmentSlots,
	...reactionSlots,
	messageFooter: [...attachmentSlots.messageFooter, ...reactionSlots.messageFooter],
}

export function SupportChat({
	subject,
	ticketId,
	transport,
}: {
	subject: string
	ticketId: string
	transport?: ClientTransportSpec
}) {
	const [client] = useState(() => transportFromSpec(transport))
	return (
		<ChatProvider instance="tickets" transport={client}>
			<ConversationUIProvider
				composerFeatures={withTextColor}
				converters={textColorConverters}
				slots={slots}
			>
				<ConversationPanel
					className="h-[70vh]"
					conversationKey={collectionKey('tickets', ticketId)}
					header={<h2 className="font-medium">{subject}</h2>}
				/>
			</ConversationUIProvider>
		</ChatProvider>
	)
}
