'use client'

import { ConfirmationModal, useModal } from '@payloadcms/ui'
import type { ReactNode } from 'react'

import { MessageBody } from '../react/MessageBody'
import { absoluteTime, relativeTime } from '../react/time'
import { useMessage } from '../react/useMessage'
import type { WindowMessage } from '../react/window'
import { TEXT_TYPE } from '../shared/constants'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import type { AuthorsMap } from '../types'
import { Avatar } from './Avatar'
import { ChatComposer } from './ChatComposer'
import { ChatSlot, useChatComponents, useTypeRenderer } from './components'
import { MessageMenu } from './MessageMenu'
import { useChatRichText } from './richText'
import './conversations.css'

export type ChatMessageProps = {
	/** Slot: extra items in the message's menu, after Reply, Edit and Delete. */
	actions?: ReactNode
	authors: AuthorsMap
	/** Hide avatar and name: a follow-up from the same author. */
	compact?: boolean
	/** Slot: under the body. */
	footer?: ReactNode
	/** Slot: replaces the name and time line. */
	header?: ReactNode
	instance: string
	message: WindowMessage
	/** Opens the message's thread; absent inside a thread. */
	onOpenThread?: (message: WindowMessage) => void
	/** The channel takes no writes here: no Edit or Delete, even on the viewer's own messages. */
	readOnly?: boolean
	/** Renders a message whose `type` is not `text`. */
	renderType?: (message: WindowMessage) => ReactNode
	/** When the viewer last read this message's thread. */
	threadReadAt?: string
	viewer: null | string
}

/**
 * One message: avatar, name, time (absolute on hover), body, edited mark,
 * thread summary, and the author's edit and delete. Deleted messages keep
 * their place as a placeholder while they still anchor a thread.
 */
export const ChatMessage = ({
	actions,
	authors,
	compact = false,
	footer,
	header,
	instance,
	message,
	onOpenThread,
	readOnly = false,
	renderType,
	threadReadAt,
	viewer,
}: ChatMessageProps) => {
	const { i18n, t } = useTranslation()
	const renderConfiguredType = useTypeRenderer(instance)
	const { openModal } = useModal()
	const deleteSlug = `conversations-delete-${instance}-${String(message.id)}`
	const author = authors[message.authorKey]
	const state = useMessage({ message, readOnly, threadReadAt, viewer })
	const { converters } = useChatRichText()
	const { deleted, editing, hasNewReplies, own, replies, setEditing } = state

	const threadSummary =
		replies > 0 && onOpenThread ? (
			<button
				className="conversations-message__thread"
				onClick={() => onOpenThread(message)}
				type="button"
			>
				<span className="conversations-message__thread-count">
					{replies === 1 ? t(keys.oneReply) : t(keys.replies, { count: replies })}
				</span>
				{hasNewReplies ? (
					<span className="conversations-message__thread-new">{t(keys.newReplies)}</span>
				) : null}
				{message.lastReplyAt ? (
					<span className="conversations-message__thread-last">
						{t(keys.lastReply, { time: relativeTime(message.lastReplyAt, i18n.language) })}
					</span>
				) : null}
			</button>
		) : null

	const classes = [
		'conversations-message',
		compact && 'conversations-message--compact',
		deleted && 'conversations-message--deleted',
		message.sendStatus && `conversations-message--${message.sendStatus}`,
	]
		.filter(Boolean)
		.join(' ')

	return (
		<div className={classes} data-message-id={String(message.id)}>
			<div className="conversations-message__gutter">
				{compact ? null : <Avatar author={author} userKey={message.authorKey} />}
			</div>
			<div className="conversations-message__main">
				{compact
					? null
					: (header ?? (
							<div className="conversations-message__header">
								<span className="conversations-message__author">
									{own ? t(keys.you) : (author?.name ?? '')}
								</span>
								<time
									className="conversations-message__time"
									dateTime={message.createdAt}
									title={absoluteTime(message.createdAt, i18n.language)}
								>
									{relativeTime(message.createdAt, i18n.language)}
								</time>
								{message.editedAt && !deleted ? (
									<span className="conversations-message__edited">· {t(keys.edited)}</span>
								) : null}
							</div>
						))}
				{deleted ? (
					<div className="conversations-message__placeholder">{t(keys.messageDeleted)}</div>
				) : editing ? (
					<ChatComposer
						channel={message.channel}
						conversationKey={message.key}
						initialBody={message.body}
						instance={instance}
						onCancel={() => setEditing(false)}
						onSave={state.save}
						parent={message.parent ?? null}
					/>
				) : message.type === TEXT_TYPE ? (
					<MessageBody
						authors={authors}
						className="conversations-message__body"
						converters={converters}
						message={message}
					/>
				) : (
					(renderType?.(message) ??
					renderConfiguredType(message) ?? (
						<div className="conversations-message__placeholder">{t(keys.unknownType)}</div>
					))
				)}
				{compact && message.editedAt && !deleted && !editing ? (
					<span className="conversations-message__edited">({t(keys.edited)})</span>
				) : null}
				{message.sendStatus === 'sending' ? (
					<div className="conversations-message__status">{t(keys.sending)}</div>
				) : null}
				{footer}
				{/* Also on a deleted placeholder: what hangs off a message (reactions) outlives its text. */}
				<ChatSlot
					channel={message.channel}
					conversationKey={message.key}
					instance={instance}
					message={message}
					name="messageFooter"
				/>
				{threadSummary}
			</div>
			{/* Its own column, so it never covers the text; shown on hover, always on touch. */}
			<div className="conversations-message__side">
				{deleted || editing || message.sendStatus ? null : (
					<MessageMenu
						actions={actions}
						instance={instance}
						message={message}
						onDelete={() => openModal(deleteSlug)}
						onEdit={() => setEditing(true)}
						onOpenThread={onOpenThread}
						own={state.canDelete}
					/>
				)}
			</div>
			{state.canDelete ? (
				<ConfirmationModal
					body={t(keys.deleteConfirm)}
					confirmLabel={t(keys.delete)}
					heading={t(keys.deleteHeading)}
					modalSlug={deleteSlug}
					onConfirm={state.remove}
				/>
			) : null}
		</div>
	)
}

/** Draws one message; `ChatFeed`, `ChatThread` and friends take it as `renderMessage`. */
export type RenderMessage = (props: ChatMessageProps) => ReactNode

/**
 * One message as the instance draws it: `render` when given, else the
 * config's `components.Message`, else `ChatMessage`. A replacement gets the
 * same props, so it can render `ChatMessage` itself to wrap the default.
 */
export const MessageView = ({
	render,
	...props
}: ChatMessageProps & { render?: RenderMessage }) => {
	const { Message } = useChatComponents(props.instance)
	if (render) return <>{render(props)}</>
	if (Message) return <Message {...props} />
	return <ChatMessage {...props} />
}
