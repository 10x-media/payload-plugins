'use client'

import { Popup } from '@payloadcms/ui'

import type { ChatSlotProps } from '../client/components'
import { useMessageMenu } from '../client/MessageMenu'
import { useExtension, useExtensionApi } from '../react/hooks'
import { ChatScope, useChatStore } from '../react/provider'
import type { WindowMessage } from '../react/window'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import type { ConversationMessage } from '../types'
import { REACTIONS, type ReactionSummary, type ReactionsClientData } from './shared'
import './reactions.css'

const summariesOf = (message: ConversationMessage | undefined): ReactionSummary[] =>
	(message?.ext?.[REACTIONS] as ReactionSummary[] | undefined) ?? []

const mineCount = (message: ConversationMessage) =>
	summariesOf(message).filter((entry) => entry.mine).length

/** Whether a new emoji (one the viewer has not used here) is refused by the per-person limit. */
const blocked = (
	message: ConversationMessage,
	emoji: string,
	limit: ReactionsClientData | undefined
): boolean =>
	Boolean(limit?.maxPerUser) &&
	limit?.onLimit === 'reject' &&
	mineCount(message) >= (limit.maxPerUser ?? 0) &&
	!summariesOf(message).some((entry) => entry.emoji === emoji && entry.mine)

/** The message with the viewer's reaction added or taken away, for an instant update. */
const optimistic = (
	message: ConversationMessage,
	{ add, emoji, replace, viewer }: { add: boolean; emoji: string; replace: boolean; viewer: string }
): ConversationMessage => {
	const list = summariesOf(message).map((entry) => ({ ...entry, users: [...entry.users] }))
	// At the limit in `replace` mode the oldest own reaction (listed first) makes room.
	const oldest = replace && add ? list.find((item) => item.mine && item.emoji !== emoji) : undefined
	if (oldest) Object.assign(oldest, { count: oldest.count - 1, mine: false })
	const entry = list.find((item) => item.emoji === emoji)
	if (add && !entry)
		list.push({ count: 1, emoji, mine: true, users: [{ name: '', userKey: viewer }] })
	if (add && entry && !entry.mine) Object.assign(entry, { count: entry.count + 1, mine: true })
	if (!add && entry?.mine) Object.assign(entry, { count: entry.count - 1, mine: false })
	return { ...message, ext: { ...message.ext, [REACTIONS]: list.filter((item) => item.count > 0) } }
}

/** Add or remove the viewer's reaction: shown at once, confirmed by the server. */
const useReact = () => {
	const store = useChatStore()
	const { merge, request } = useExtensionApi(REACTIONS)
	const limit = useExtension<ReactionsClientData>(REACTIONS)
	return async (message: ConversationMessage, emoji: string) => {
		const mine = summariesOf(message).some((entry) => entry.emoji === emoji && entry.mine)
		if (!mine && blocked(message, emoji, limit)) return
		const viewer = store.meta?.viewer ?? ''
		const replace =
			limit?.onLimit === 'replace' &&
			Boolean(limit.maxPerUser) &&
			mineCount(message) >= (limit.maxPerUser ?? 0)
		store.emitLocal(message.key, {
			message: optimistic(message, { add: !mine, emoji, replace, viewer }) as WindowMessage,
			type: 'confirmed',
		})
		try {
			const result = await request<{ message: WindowMessage }>(mine ? '/remove' : '/add', {
				body: { emoji, message: message.id },
			})
			merge([result.message])
		} catch {
			// Put the server's view back.
			store.emitLocal(message.key, { message: message as WindowMessage, type: 'confirmed' })
		}
	}
}

const SmileIcon = () => (
	<svg aria-hidden="true" fill="none" height="16" viewBox="0 0 16 16" width="16">
		<circle cx="8" cy="8" r="5.75" stroke="currentColor" strokeWidth="1.3" />
		<path
			d="M5.75 9.25a2.75 2.75 0 0 0 4.5 0"
			stroke="currentColor"
			strokeLinecap="round"
			strokeWidth="1.3"
		/>
		<circle cx="6.25" cy="6.5" fill="currentColor" r=".8" />
		<circle cx="9.75" cy="6.5" fill="currentColor" r=".8" />
	</svg>
)

/** The emoji the instance allows, as a row; picking toggles the viewer's reaction. */
const EmojiRow = ({
	message,
	onPicked,
}: {
	message: ConversationMessage
	onPicked?: () => void
}) => {
	const { t } = useTranslation()
	const react = useReact()
	const data = useExtension<ReactionsClientData>(REACTIONS)
	if (!data?.emojis.length) return null
	const mine = new Set(
		summariesOf(message)
			.filter((entry) => entry.mine)
			.map((entry) => entry.emoji)
	)
	return (
		<div className="conversations-reaction-row">
			{data.emojis.map((emoji) => {
				const refused = blocked(message, emoji, data)
				return (
					<button
						aria-pressed={mine.has(emoji)}
						className={`conversations-reaction-row__emoji${mine.has(emoji) ? ' conversations-reaction-row__emoji--mine' : ''}`}
						disabled={refused}
						key={emoji}
						onClick={() => {
							onPicked?.()
							void react(message, emoji)
						}}
						title={refused ? t(keys.reactionLimit, { count: data.maxPerUser }) : undefined}
						type="button"
					>
						{emoji}
					</button>
				)
			})}
		</div>
	)
}

/** The add button at the end of the reactions: the same row, in Payload's popup. */
const AddReaction = ({ message }: { message: ConversationMessage }) => {
	const { t } = useTranslation()
	return (
		<Popup
			button={
				<>
					<SmileIcon />
					<span className="conversations-sr-only">{t(keys.addReaction)}</span>
				</>
			}
			buttonClassName="conversations-reactions__add"
			buttonType="custom"
			caret={false}
			horizontalAlign="left"
			render={({ close }) => <EmojiRow message={message} onPicked={close} />}
			size="fit-content"
			verticalAlign="top"
		/>
	)
}

const tooltip = (
	entry: ReactionSummary,
	t: ReturnType<typeof useTranslation>['t'],
	you: string
) => {
	const names = entry.users
		.map((user) => (entry.mine && !user.name ? you : user.name))
		.filter(Boolean)
	const more = entry.count - names.length
	const list =
		more > 0 ? `${names.join(', ')} ${t(keys.reactionsMore, { count: more })}` : names.join(', ')
	return t(keys.reactedWith, { emoji: entry.emoji, names: list })
}

const Bar = ({ message }: { message: ConversationMessage }) => {
	const { t } = useTranslation()
	const react = useReact()
	const list = summariesOf(message)
	// A deleted message keeps its reactions; only your own can still be taken back.
	const deleted = Boolean(message.deletedAt)
	const limit = useExtension<ReactionsClientData>(REACTIONS)
	if (list.length === 0) return null
	return (
		<div className="conversations-reactions">
			{list.map((entry) => (
				<button
					aria-pressed={entry.mine}
					className={`conversations-reactions__pill${entry.mine ? ' conversations-reactions__pill--mine' : ''}`}
					disabled={(deleted && !entry.mine) || blocked(message, entry.emoji, limit)}
					key={entry.emoji}
					onClick={() => void react(message, entry.emoji)}
					title={tooltip(entry, t, t(keys.you))}
					type="button"
				>
					<span className="conversations-reactions__emoji">{entry.emoji}</span>
					<span className="conversations-reactions__count">{entry.count}</span>
				</button>
			))}
			{deleted ? null : <AddReaction message={message} />}
		</div>
	)
}

/** `messageFooter` slot: the reactions under a message, click to toggle your own. */
export const ReactionsBar = ({ instance, message }: ChatSlotProps) =>
	message ? (
		<ChatScope instance={instance}>
			<Bar message={message} />
		</ChatScope>
	) : null

/** `messageQuickActions` slot: the emoji row at the top of a message's menu. */
export const ReactionQuickActions = ({ instance, message }: ChatSlotProps) => {
	const menu = useMessageMenu()
	return message && !message.deletedAt ? (
		<ChatScope instance={instance}>
			<EmojiRow message={message} onPicked={menu?.close} />
		</ChatScope>
	) : null
}
