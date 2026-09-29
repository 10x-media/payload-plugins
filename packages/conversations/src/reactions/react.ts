'use client'

import { useSyncExternalStore } from 'react'

import { useExtension, useExtensionApi } from '../react/hooks'
import { useChatStore } from '../react/provider'
import type { WindowMessage } from '../react/window'
import type { ConversationMessage } from '../types'
import { REACTIONS, type ReactionSummary, type ReactionsClientData } from './shared'

/** The reactions `decorate` put on a message, in the order they were first used. */
export const summariesOf = (message: ConversationMessage | undefined): ReactionSummary[] =>
	(message?.ext?.[REACTIONS] as ReactionSummary[] | undefined) ?? []

const mineCount = (message: ConversationMessage) =>
	summariesOf(message).filter((entry) => entry.mine).length

/** Whether a new emoji (one the viewer has not used here) is refused by the per-person limit. */
export const blocked = (
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
export const useReact = () => {
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

export type UseReactionsResult = {
	/** The emoji the instance allows, in picker order. */
	emojis: string[]
	/** A new emoji is refused here by the per-person limit (`reject` mode). */
	isBlocked: (message: ConversationMessage, emoji: string) => boolean
	/** The per-person limit and what happens at it, if the instance has one. */
	limit: ReactionsClientData | undefined
	/** The viewer's reactions on a message. */
	mine: (message: ConversationMessage) => Set<string>
	/**
	 * The message's channel takes no posts from the viewer and the instance
	 * keeps reactions closed there: show them, offer no changes.
	 */
	readOnly: (message: ConversationMessage) => boolean
	summaries: (message: ConversationMessage) => ReactionSummary[]
	/** Add or take back the viewer's reaction: shown at once, confirmed by the server. */
	toggle: (message: ConversationMessage, emoji: string) => Promise<void>
}

/**
 * Reactions for any markup: the allowed emoji, each message's reactions, the
 * per-person limit, and an optimistic toggle. The admin's bar and picker and
 * a website's draw this.
 */
export const useReactions = (): UseReactionsResult => {
	const limit = useExtension<ReactionsClientData>(REACTIONS)
	const toggle = useReact()
	const store = useChatStore()
	useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion)
	return {
		emojis: limit?.emojis ?? [],
		isBlocked: (message, emoji) => blocked(message, emoji, limit),
		limit,
		mine: (message) =>
			new Set(
				summariesOf(message)
					.filter((entry) => entry.mine)
					.map((entry) => entry.emoji)
			),
		// An unknown key counts as open; the server has the last word.
		readOnly: (message) =>
			!limit?.allowReadOnly &&
			store.entry(message.key)?.channels.find((entry) => entry.slug === message.channel)
				?.canCreate === false,
		summaries: summariesOf,
		toggle,
	}
}
