'use client'

import { Button, useDocumentInfo, useDocumentTitle, useModal } from '@payloadcms/ui'
import type { ReactNode } from 'react'

import { useChannels } from '../react/hooks'
import { ChatScope } from '../react/provider'
import { collectionKey, globalKey } from '../shared/keys'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { ChatDrawer } from './ChatDrawer'
import { replaceable } from './components'
import './conversations.css'

export type ChatTriggerProps = {
	/** The channel the drawer opens on; see `ChatDrawer`'s `channel`. */
	channel?: null | string
	/** Overrides the key taken from the document being edited. */
	conversationKey?: string
	/**
	 * Shown instead of the button once it is known the viewer can read no
	 * channel of the conversation. Default: nothing.
	 */
	fallback?: ReactNode
	instance: string
	/** A message id the drawer opens at; see `ChatDrawer`'s `message`. */
	message?: null | string
	/** The drawer's line under the title. Default: the edited document's title. */
	subtitle?: ReactNode
	/** The drawer's title. Default: "Comments". */
	title?: ReactNode
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

const TriggerButton = ({
	channel,
	conversationKey,
	fallback,
	instance,
	message,
	subtitle,
	title,
}: ChatTriggerProps & { conversationKey: string }) => {
	const { t } = useTranslation()
	const { openModal } = useModal()
	const { title: documentTitle } = useDocumentTitle()
	const { channels, count, reads, status, unread } = useChannels(conversationKey)
	if (channels.length === 0) return status === 'loading' ? null : (fallback ?? null)
	const drawerSlug = `conversations-${instance}-${conversationKey.replace(/[^a-zA-Z0-9-]/g, '-')}`
	return (
		<>
			<Button
				buttonStyle="secondary"
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
				channel={channel}
				conversationKey={conversationKey}
				drawerSlug={drawerSlug}
				instance={instance}
				message={message}
				subtitle={subtitle === undefined ? documentTitle : subtitle}
				title={title}
			/>
		</>
	)
}

/**
 * The document-controls button: count, unread dot, and the drawer it opens.
 * Renders nothing on a create view (no id yet), and `fallback` when the user
 * can read no channel of this document.
 */
const DefaultTrigger = ({ conversationKey, ...props }: ChatTriggerProps) => {
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
		<ChatScope instance={props.instance}>
			<TriggerButton {...props} conversationKey={key} />
		</ChatScope>
	)
}

/** The document-controls button `comments()` adds. Replaceable through `components.Trigger`. */
export const ChatTrigger = replaceable('Trigger', DefaultTrigger)
