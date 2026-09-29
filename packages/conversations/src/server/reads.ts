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
				// Thread rows carry no channel; naming it lets the unique index serve `thread`.
				{ channel: { equals: '' } },
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
 * newer than that channel's cursor, capped at `UNREAD_CAP` each.
 *
 * One query for every pair: an `or` of one branch per key and channel, each
 * served by the `(key, channel, parent, createdAt)` index, counted here. When
 * that query hits its limit, a busy pair may have crowded out others, so the
 * pairs still under the cap are counted again one query each.
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
	const pairs: Array<{ channel: string; cursor?: string; key: string }> = []
	for (const { channels, key } of entries) {
		out[key] = Object.fromEntries(channels.map((channel) => [channel, 0]))
		for (const channel of channels) {
			pairs.push({ channel, cursor: cursors.get(key)?.[channel], key })
		}
	}
	if (pairs.length === 0) return out

	const common: Where[] = [
		{ parent: { equals: null } },
		{ deletedAt: { equals: null } },
		{ authorKey: { not_equals: userKey } },
	]
	const branch = ({ channel, cursor, key }: (typeof pairs)[number]): Where => ({
		and: [
			{ key: { equals: key } },
			{ channel: { equals: channel } },
			...(cursor ? [{ createdAt: { greater_than: cursor } }] : []),
		],
	})
	const find = (where: Where, limit: number) =>
		req.payload.db.find({
			collection: instance.messagesSlug,
			limit,
			pagination: false,
			select: { channel: true, key: true },
			where,
		})

	const limit = UNREAD_CAP * pairs.length
	const result = await find({ and: [...common, { or: pairs.map(branch) }] }, limit)
	for (const row of result.docs as unknown as Array<{ channel: string; key: string }>) {
		const counts = out[row.key]
		if (counts && row.channel in counts) {
			counts[row.channel] = Math.min(UNREAD_CAP, (counts[row.channel] ?? 0) + 1)
		}
	}
	if (result.docs.length >= limit) {
		const starved = pairs.filter((pair) => (out[pair.key]?.[pair.channel] ?? 0) < UNREAD_CAP)
		await Promise.all(
			starved.map(async (pair) => {
				const exact = await find({ and: [...common, branch(pair)] }, UNREAD_CAP)
				const counts = out[pair.key]
				if (counts) counts[pair.channel] = exact.docs.length
			})
		)
	}
	return out
}
