import { type CollectionSlug, createLocalReq, type PayloadRequest, type TypedUser } from 'payload'

import { parseKey, parseUserKey, userKey } from '../shared/keys'
import type { ConversationsInstance } from '../types'

/** Load users by key across the instance's users collections, skipping unknown ones. */
export const loadUsers = async (
	req: PayloadRequest,
	instance: ConversationsInstance,
	userKeys: Iterable<string>
): Promise<Map<string, Record<string, unknown> & { collection: string }>> => {
	const byCollection = new Map<string, Set<string>>()
	const served = new Set(instance.users.map((entry) => entry.collection))
	for (const key of userKeys) {
		const ref = parseUserKey(key)
		if (ref && served.has(ref.collection)) {
			const ids = byCollection.get(ref.collection) ?? new Set<string>()
			ids.add(ref.id)
			byCollection.set(ref.collection, ids)
		}
	}
	const found = new Map<string, Record<string, unknown> & { collection: string }>()
	await Promise.all(
		[...byCollection].map(async ([collection, ids]) => {
			const result = await req.payload.find({
				collection: collection as CollectionSlug,
				depth: 0,
				limit: ids.size,
				overrideAccess: true,
				pagination: false,
				req,
				where: { id: { in: [...ids] } },
			})
			for (const doc of result.docs as unknown as Array<Record<string, unknown>>) {
				found.set(userKey(collection, doc.id as string), { ...doc, collection })
			}
		})
	)
	return found
}

/** A request acting as `user`, for running access on someone else's behalf. */
export const requestAs = async (
	req: PayloadRequest,
	user: Record<string, unknown> & { collection: string }
): Promise<PayloadRequest> =>
	createLocalReq(
		{ context: req.context, locale: req.locale ?? undefined, user: user as unknown as TypedUser },
		req.payload
	)

/**
 * The users among `userKeys` who can read `channel` of `key`: conversation
 * access and channel `read`, each run as that user. Used for mentions, so the
 * `afterMention` promise holds: a mentioned user can read the message.
 */
export const filterReaders = async (
	req: PayloadRequest,
	instance: ConversationsInstance,
	{ channel, key, userKeys }: { channel: string; key: string; userKeys: string[] }
): Promise<string[]> => {
	const target = parseKey(key)
	const channelConfig = instance.channels.get(channel)
	if (!target || !channelConfig || userKeys.length === 0) {
		return []
	}
	const users = await loadUsers(req, instance, userKeys)
	const readable = await Promise.all(
		userKeys.map(async (candidate) => {
			const user = users.get(candidate)
			if (!user) {
				return false
			}
			const asUser = await requestAs(req, user)
			const allowed = await instance.allowedKeys(asUser, [key])
			if (!allowed.has(key)) {
				return false
			}
			return channelConfig.access.read({ key, req: asUser, target })
		})
	)
	return userKeys.filter((_, index) => readable[index])
}
