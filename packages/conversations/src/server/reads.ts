import type { PayloadRequest, Where } from 'payload'

import type { ConversationsInstance } from '../types'

type ReadRow = { id: number | string; key: string; lastReadAt: string; thread?: null | string }

/** Unread counts stop here; the UI shows "99+". */
export const UNREAD_CAP = 100

const findCursor = async (
	req: PayloadRequest,
	collection: string,
	where: Where
): Promise<ReadRow | null> =>
	(await req.payload.db.findOne({ collection, where })) as ReadRow | null

/**
 * Raise a user's read cursor to `at`, never lowering it. Runs outside the
 * request transaction on purpose: a lost race on the unique index must not
 * roll back the message that triggered it.
 *
 * On Postgres the conditional update is select-then-update, so two concurrent
 * raises by one user can leave the cursor slightly behind; the next raise
 * heals it. A first-create race loses on the unique index and retries as an
 * update.
 */
export const raiseCursor = async (
	req: PayloadRequest,
	instance: ConversationsInstance,
	args: { at: Date | string; key: string; thread?: string; userKey: string }
): Promise<void> => {
	const collection = instance.readsSlug
	if (!collection) {
		return
	}
	const at = new Date(args.at).toISOString()
	const thread = args.thread ?? ''
	const where: Where = {
		and: [
			{ userKey: { equals: args.userKey } },
			{ key: { equals: args.key } },
			{ thread: { equals: thread } },
		],
	}
	for (let attempt = 0; attempt < 2; attempt++) {
		const row = await findCursor(req, collection, where)
		if (row) {
			if (new Date(row.lastReadAt).getTime() < new Date(at).getTime()) {
				await req.payload.db.updateOne({
					collection,
					data: { lastReadAt: at },
					id: row.id,
					returning: false,
				})
			}
			return
		}
		try {
			await req.payload.db.create({
				collection,
				data: { key: args.key, lastReadAt: at, thread, userKey: args.userKey },
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

/** Conversation cursors (`thread` empty) of one user for many keys, in one query. */
export const conversationCursors = async (
	req: PayloadRequest,
	instance: ConversationsInstance,
	{ keys, userKey }: { keys: string[]; userKey: string }
): Promise<Map<string, string>> => {
	const cursors = new Map<string, string>()
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
		cursors.set(row.key, new Date(row.lastReadAt).toISOString())
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
 * newer than the cursor. One capped query per key, run in parallel.
 */
export const unreadCounts = async (
	req: PayloadRequest,
	instance: ConversationsInstance,
	{
		cursors,
		entries,
		userKey,
	}: {
		cursors: Map<string, string>
		entries: Array<{ channels: string[]; key: string }>
		userKey: string
	}
): Promise<Record<string, Record<string, number>>> => {
	const out: Record<string, Record<string, number>> = {}
	await Promise.all(
		entries.map(async ({ channels, key }) => {
			const counts: Record<string, number> = Object.fromEntries(channels.map((c) => [c, 0]))
			out[key] = counts
			if (channels.length === 0) {
				return
			}
			const cursor = cursors.get(key)
			const result = await req.payload.db.find({
				collection: instance.messagesSlug,
				limit: UNREAD_CAP,
				pagination: false,
				select: { channel: true },
				where: {
					and: [
						{ key: { equals: key } },
						{ channel: { in: channels } },
						{ parent: { equals: null } },
						{ deletedAt: { equals: null } },
						{ authorKey: { not_equals: userKey } },
						...(cursor ? [{ createdAt: { greater_than: cursor } }] : []),
					],
				},
			})
			for (const row of result.docs as unknown as Array<{ channel: string }>) {
				counts[row.channel] = (counts[row.channel] ?? 0) + 1
			}
		})
	)
	return out
}
