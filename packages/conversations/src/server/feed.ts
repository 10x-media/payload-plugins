import type { PayloadRequest, Where } from 'payload'

import { isRemoved } from '../collections/messages'
import type { WireMessage } from '../shared/wire'
import type { ConversationMessage, ConversationsInstance } from '../types'

/** A keyset position: a message's `createdAt` and `id`, ties broken by id. */
export type FeedCursor = { createdAt: string; id: string }

export type FeedWindow =
	| { after: FeedCursor; mode: 'after' }
	| { around: string; mode: 'around' }
	| { before: FeedCursor; mode: 'before' }
	| { mode: 'latest' }
	| { mode: 'updatedSince'; since: string }

export type FeedQuery = {
	channels: string[]
	key: string
	limit: number
	parent?: null | string
	window: FeedWindow
}

export type FeedResult = {
	hasNewer: boolean
	hasOlder: boolean
	messages: WireMessage[]
}

export const MAX_LIMIT = 100
export const CHANGES_LIMIT = 200

export const parseCursor = (value: unknown): FeedCursor | null => {
	if (typeof value !== 'string') {
		return null
	}
	const separator = value.indexOf(',')
	if (separator <= 0) {
		return null
	}
	const createdAt = new Date(value.slice(0, separator))
	const id = value.slice(separator + 1)
	if (Number.isNaN(createdAt.getTime()) || !id) {
		return null
	}
	return { createdAt: createdAt.toISOString(), id }
}

const olderThan = (cursor: FeedCursor): Where => ({
	or: [
		{ createdAt: { less_than: cursor.createdAt } },
		{ and: [{ createdAt: { equals: cursor.createdAt } }, { id: { less_than: cursor.id } }] },
	],
})

const newerThan = (cursor: FeedCursor): Where => ({
	or: [
		{ createdAt: { greater_than: cursor.createdAt } },
		{ and: [{ createdAt: { equals: cursor.createdAt } }, { id: { greater_than: cursor.id } }] },
	],
})

/** Hides what `placeholderIfReplies` removes: deleted replies and deleted roots without replies. */
const visible = (instance: ConversationsInstance, parent: null | string): Where | null => {
	if (instance.deleted === 'placeholder') {
		return null
	}
	if (parent) {
		return { deletedAt: { equals: null } }
	}
	return { or: [{ deletedAt: { equals: null } }, { replyCount: { greater_than: 0 } }] }
}

/**
 * Visible root messages per key across its readable channels, for trigger
 * badges. One count per key, run in parallel.
 */
export const messageCounts = async (
	req: PayloadRequest,
	instance: ConversationsInstance,
	entries: Array<{ channels: string[]; key: string }>
): Promise<Record<string, number>> => {
	const shown = visible(instance, null)
	const counts = await Promise.all(
		entries.map(async ({ channels, key }) => {
			const result = await req.payload.db.count({
				collection: instance.messagesSlug,
				where: {
					and: [
						{ key: { equals: key } },
						{ channel: { in: channels } },
						{ parent: { equals: null } },
						...(shown ? [shown] : []),
					],
				},
			})
			return [key, result.totalDocs] as const
		})
	)
	return Object.fromEntries(counts)
}

const toWire = (instance: ConversationsInstance, message: ConversationMessage): WireMessage =>
	isRemoved(instance, message) ? { ...message, removed: true } : message

/**
 * One page of a feed or thread. Every query fetches `limit + 1` without a
 * count, which is how `hasOlder` / `hasNewer` are learned. Change sync
 * (`updatedSince`) returns deleted rows too, flagged `removed`, so a client
 * can drop them from its window.
 */
export const loadFeed = async (
	req: PayloadRequest,
	instance: ConversationsInstance,
	query: FeedQuery
): Promise<FeedResult> => {
	const parent = query.parent ?? null
	const limit = Math.max(1, Math.min(query.limit, MAX_LIMIT))
	const base: Where[] = [
		{ key: { equals: query.key } },
		{ channel: { in: query.channels } },
		{ parent: { equals: parent } },
	]

	const find = async (where: Where[], sort: string[], take: number) => {
		const result = await req.payload.find({
			collection: instance.messagesSlug,
			depth: 0,
			limit: take,
			overrideAccess: true,
			pagination: false,
			req,
			sort,
			where: { and: where },
		})
		return result.docs as unknown as ConversationMessage[]
	}

	const window = query.window
	if (window.mode === 'updatedSince') {
		const docs = await find(
			[...base, { updatedAt: { greater_than: window.since } }],
			['updatedAt'],
			CHANGES_LIMIT
		)
		return {
			hasNewer: docs.length >= CHANGES_LIMIT,
			hasOlder: false,
			messages: docs.map((doc) => toWire(instance, doc)),
		}
	}

	const shown = visible(instance, parent)
	const scoped = shown ? [...base, shown] : base
	const newestFirst = ['-createdAt', '-id']
	const oldestFirst = ['createdAt', 'id']

	if (window.mode === 'latest' || window.mode === 'before') {
		const docs = await find(
			window.mode === 'before' ? [...scoped, olderThan(window.before)] : scoped,
			newestFirst,
			limit + 1
		)
		return {
			hasNewer: window.mode === 'before',
			hasOlder: docs.length > limit,
			messages: docs.slice(0, limit).reverse(),
		}
	}

	if (window.mode === 'after') {
		const docs = await find([...scoped, newerThan(window.after)], oldestFirst, limit + 1)
		return { hasNewer: docs.length > limit, hasOlder: true, messages: docs.slice(0, limit) }
	}

	// Around a moment: the first unread message sits at the seam, a third of the page above it.
	const above = Math.max(1, Math.floor(limit / 3))
	const below = limit - above
	const [older, newer] = await Promise.all([
		find([...scoped, { createdAt: { less_than_equal: window.around } }], newestFirst, above + 1),
		find([...scoped, { createdAt: { greater_than: window.around } }], oldestFirst, below + 1),
	])
	return {
		hasNewer: newer.length > below,
		hasOlder: older.length > above,
		messages: [...older.slice(0, above).reverse(), ...newer.slice(0, below)],
	}
}

/**
 * The change query behind polling: which of the given keys have a message in
 * a readable channel updated after `since`. One statement.
 */
/**
 * How far back a change check looks at most. Tokens live ten minutes, so a
 * client whose last check is older has resubscribed and reloaded since.
 */
export const MAX_CHANGE_WINDOW_MS = 60 * 60 * 1000

export const changedKeys = async (
	req: PayloadRequest,
	instance: ConversationsInstance,
	{ entries, since }: { entries: Array<{ channels: string[]; key: string }>; since: string }
): Promise<string[]> => {
	const scoped = entries.filter((entry) => entry.channels.length > 0)
	if (scoped.length === 0) {
		return []
	}
	// The client sends `since`: a date in 1970 would read every row of the keys.
	const floor = new Date(Date.now() - MAX_CHANGE_WINDOW_MS).toISOString()
	const result = await req.payload.db.find({
		collection: instance.messagesSlug,
		limit: 0,
		pagination: false,
		select: { key: true },
		where: {
			and: [
				{ updatedAt: { greater_than: since > floor ? since : floor } },
				{
					or: scoped.map(
						(entry): Where => ({
							and: [{ key: { equals: entry.key } }, { channel: { in: entry.channels } }],
						})
					),
				},
			],
		},
	})
	return [...new Set((result.docs as unknown as Array<{ key: string }>).map((doc) => doc.key))]
}
