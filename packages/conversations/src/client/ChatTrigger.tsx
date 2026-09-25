'use client'

import { Button, useDocumentInfo, useModal } from '@payloadcms/ui'

import { useChannels } from '../react/hooks'
import { ChatScope } from '../react/provider'
import { collectionKey, globalKey } from '../shared/keys'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { ChatDrawer } from './ChatDrawer'
import './conversations.css'

export type ChatTriggerProps = {
	/** Overrides the key taken from the document being edited. */
	conversationKey?: string
	instance: string
}

const CommentIcon = () => (
	<svg aria-hidden="true" fill="none" height="16" viewBox="0 0 16 16" width="16">
		<path
			d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"
			stroke="currentColor"
			strokeLinejoin="round"
			strokeWidth="1.3"
		/>
	</svg>
)

const TriggerButton = ({ conversationKey, instance }: Required<ChatTriggerProps>) => {
	const { t } = useTranslation()
	const { openModal } = useModal()
	const { title } = useDocumentInfo()
	const { channels, count, reads, unread } = useChannels(conversationKey)
	if (channels.length === 0) return null
	const drawerSlug = `conversations-${instance}-${conversationKey.replace(/[^a-zA-Z0-9-]/g, '-')}`
	return (
		<>
			<Button
				buttonStyle="subtle"
				className="conversations-trigger"
				icon={<CommentIcon />}
				iconPosition="left"
				margin={false}
				onClick={() => openModal(drawerSlug)}
				size="medium"
			>
				{count === 0 ? t(keys.comment) : t(keys.comments)}
				{count > 0 ? <span className="conversations-trigger__count">{count}</span> : null}
				{reads && unread > 0 ? (
					<span aria-label={t(keys.unreadDot)} className="conversations-trigger__dot" role="img" />
				) : null}
			</Button>
			<ChatDrawer
				conversationKey={conversationKey}
				drawerSlug={drawerSlug}
				instance={instance}
				subtitle={title}
			/>
		</>
	)
}

/**
 * The document-controls button: count, unread dot, and the drawer it opens.
 * Renders nothing on a create view (no id yet) or when the user can read no
 * channel of this document.
 */
export const ChatTrigger = ({ conversationKey, instance }: ChatTriggerProps) => {
	const { collectionSlug, globalSlug, id } = useDocumentInfo()
	const key =
		conversationKey ??
		(collectionSlug && id !== undefined && id !== null
			? collectionKey(collectionSlug, id)
			: globalSlug
				? globalKey(globalSlug)
				: null)
	if (!key) return null
	return (
		<ChatScope instance={instance}>
			<TriggerButton conversationKey={key} instance={instance} />
		</ChatScope>
	)
}
