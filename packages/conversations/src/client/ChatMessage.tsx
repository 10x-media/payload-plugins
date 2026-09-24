'use client'

import { type ReactNode, useState } from 'react'

import { useMessageActions } from '../react/hooks'
import { MessageBody } from '../react/MessageBody'
import type { WindowMessage } from '../react/window'
import { TEXT_TYPE } from '../shared/constants'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import type { AuthorsMap } from '../types'
import { Avatar } from './Avatar'
import { ChatComposer } from './ChatComposer'
import { ChatSlot, useTypeRenderer } from './components'
import { absoluteTime, relativeTime } from './time'
import './conversations.css'

export type ChatMessageProps = {
	/** Slot: extra actions in the hover row. */
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
	renderType,
	threadReadAt,
	viewer,
}: ChatMessageProps) => {
	const { i18n, t } = useTranslation()
	const { edit, remove } = useMessageActions()
	const renderConfiguredType = useTypeRenderer(instance)
	const [editing, setEditing] = useState(false)
	const author = authors[message.authorKey]
	const own = viewer !== null && message.authorKey === viewer
	const deleted = Boolean(message.deletedAt)
	const replies = message.replyCount ?? 0
	const hasNewReplies =
		replies > 0 &&
		Boolean(message.lastReplyAt) &&
		(!threadReadAt || new Date(message.lastReplyAt as string) > new Date(threadReadAt))

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
						onSave={async (body) => {
							await edit(message, { body })
							setEditing(false)
						}}
						parent={message.parent ?? null}
					/>
				) : message.type === TEXT_TYPE ? (
					<MessageBody
						authors={authors}
						className="conversations-message__body"
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
				{deleted ? null : (
					<ChatSlot
						channel={message.channel}
						conversationKey={message.key}
						instance={instance}
						message={message}
						name="messageFooter"
					/>
				)}
				{threadSummary}
			</div>
			{deleted || editing || message.sendStatus ? null : (
				<div className="conversations-message__actions">
					{onOpenThread ? (
						<button
							className="conversations-icon-button"
							onClick={() => onOpenThread(message)}
							title={t(keys.reply)}
							type="button"
						>
							{t(keys.reply)}
						</button>
					) : null}
					{own && message.type === TEXT_TYPE ? (
						<button
							className="conversations-icon-button"
							onClick={() => setEditing(true)}
							title={t(keys.edit)}
							type="button"
						>
							{t(keys.edit)}
						</button>
					) : null}
					{own ? (
						<button
							className="conversations-icon-button"
							onClick={() => {
								if (window.confirm(t(keys.deleteConfirm))) void remove(message)
							}}
							title={t(keys.delete)}
							type="button"
						>
							{t(keys.delete)}
						</button>
					) : null}
					{actions}
					<ChatSlot
						channel={message.channel}
						conversationKey={message.key}
						instance={instance}
						message={message}
						name="messageActions"
					/>
				</div>
			)}
		</div>
	)
}
