import type { CollectionSlug, PayloadRequest, Where } from 'payload'

import type { ConversationsInstance } from '../types'

type ReadRow = {
	channel?: null | string
	id: number | string
	key: string
	lastReadAt: string
	thread?: null | string
}

/** Unread counts stop here; the UI shows "99+". */
export const UNREAD_CAP = 100

const findCursor = async (
	req: PayloadRequest,
	collection: CollectionSlug,
	where: Where
): Promise<ReadRow | null> =>
	(await req.payload.db.findOne({ collection, where })) as ReadRow | null

/**
 * Raise a user's read cursor to `at`, never lowering it. Runs outside the
 * request transaction on purpose: a lost race on the unique index must not
 * roll back the message that triggered it.
 *
 * The update carries its `lastReadAt < at` condition, so on Mongo it is one
 * atomic statement. On Postgres the adapter selects then updates, so two
 * concurrent raises by one user can leave the cursor slightly behind; the
 * next raise heals it. A first-create race loses on the unique index and
 * retries as an update.
 */
export const raiseCursor = async (
	req: PayloadRequest,
	instance: ConversationsInstance,
	args: {
		at: Date | string
		/** The channel of a conversation cursor; empty for a thread cursor. */
		channel?: string
		key: string
		thread?: string
		userKey: string
	}
): Promise<void> => {
	const collection = instance.readsSlug
	if (!collection) {
		return
	}
	const at = new Date(args.at).toISOString()
	const thread = args.thread ?? ''
	// A thread cursor belongs to its root, whatever the channel.
	const channel = thread ? '' : (args.channel ?? '')
	const where: Where = {
		and: [
			{ userKey: { equals: args.userKey } },
			{ key: { equals: args.key } },
			{ channel: { equals: channel } },
			{ thread: { equals: thread } },
		],
	}
	for (let attempt = 0; attempt < 2; attempt++) {
		const row = await findCursor(req, collection, where)
		if (row) {
			if (new Date(row.lastReadAt).getTime() < new Date(at).getTime()) {
				// The condition sits in the statement so a concurrent smaller raise cannot win.
				await req.payload.db.updateOne({
					collection,
					data: { lastReadAt: at },
					returning: false,
					where: { and: [{ id: { equals: row.id } }, { lastReadAt: { less_than: at } }] },
				})
			}
			return
		}
		try {
			await req.payload.db.create({
				collection,
				data: { channel, key: args.key, lastReadAt: at, thread, userKey: args.userKey },
				returning: false,
			})
			return
		} catch (error) {
			if (attempt > 0) {
				throw error
			}
		}
	}
}

/** Per-channel cursors of one user for many keys, in one query: `key -> channel -> at`. */
export const conversationCursors = async (
	req: PayloadRequest,
	instance: ConversationsInstance,
	{ keys, userKey }: { keys: string[]; userKey: string }
): Promise<Map<string, Record<string, string>>> => {
	const cursors = new Map<string, Record<string, string>>()
	if (!instance.readsSlug || keys.length === 0) {
		return cursors
	}
	const result = await req.payload.db.find({
		collection: instance.readsSlug,
		limit: 0,
		pagination: false,
		where: {
			and: [{ userKey: { equals: userKey } }, { key: { in: keys } }, { thread: { equals: '' } }],
		},
	})
	for (const row of result.docs as ReadRow[]) {
		if (!row.channel) continue
		const byChannel = cursors.get(row.key) ?? {}
		byChannel[row.channel] = new Date(row.lastReadAt).toISOString()
		cursors.set(row.key, byChannel)
	}
	return cursors
}

/** Thread cursors of one user for the given roots of one conversation. */
export const threadCursors = async (
	req: PayloadRequest,
	instance: ConversationsInstance,
	{ key, rootIds, userKey }: { key: string; rootIds: string[]; userKey: string }
): Promise<Record<string, string>> => {
	const cursors: Record<string, string> = {}
	if (!instance.readsSlug || rootIds.length === 0) {
		return cursors
	}
	const result = await req.payload.db.find({
		collection: instance.readsSlug,
		limit: 0,
		pagination: false,
		where: {
			and: [
				{ userKey: { equals: userKey } },
				{ key: { equals: key } },
				{ thread: { in: rootIds } },
			],
		},
	})
	for (const row of result.docs as ReadRow[]) {
		if (row.thread) {
			cursors[row.thread] = new Date(row.lastReadAt).toISOString()
		}
	}
	return cursors
}

/**
 * Unread root messages per channel for each key: other people's, not deleted,
 * newer than that channel's cursor. One capped query per key and channel, run
 * in parallel.
 */
export const unreadCounts = async (
	req: PayloadRequest,
	instance: ConversationsInstance,
	{
		cursors,
		entries,
		userKey,
	}: {
		cursors: Map<string, Record<string, string>>
		entries: Array<{ channels: string[]; key: string }>
		userKey: string
	}
): Promise<Record<string, Record<string, number>>> => {
	const out: Record<string, Record<string, number>> = {}
	for (const { channels, key } of entries) {
		out[key] = Object.fromEntries(channels.map((channel) => [channel, 0]))
	}
	await Promise.all(
		entries.flatMap(({ channels, key }) =>
			channels.map(async (channel) => {
				const cursor = cursors.get(key)?.[channel]
				const result = await req.payload.db.find({
					collection: instance.messagesSlug,
					limit: UNREAD_CAP,
					pagination: false,
					select: { id: true },
					where: {
						and: [
							{ key: { equals: key } },
							{ channel: { equals: channel } },
							{ parent: { equals: null } },
							{ deletedAt: { equals: null } },
							{ authorKey: { not_equals: userKey } },
							...(cursor ? [{ createdAt: { greater_than: cursor } }] : []),
						],
					},
				})
				const counts = out[key]
				if (counts) counts[channel] = result.docs.length
			})
		)
	)
	return out
}
