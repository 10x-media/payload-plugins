import {
	type CollectionSlug,
	createLocalReq,
	type PayloadRequest,
	type TypedUser,
	type Where,
} from 'payload'

import { parseKey, parseUserKey, userKey } from '../shared/keys'
import type { ConversationsInstance } from '../types'
import { channelAllows } from './access'

type LoadedUser = Record<string, unknown> & { collection: string }

/**
 * Load users by key across the instance's users collections, skipping unknown
 * ones. `scope` narrows each collection's query further.
 */
export const loadUsers = async (
	req: PayloadRequest,
	instance: ConversationsInstance,
	{
		scope,
		userKeys,
	}: {
		scope?: (collection: string) => Promise<undefined | Where> | undefined | Where
		userKeys: Iterable<string>
	}
): Promise<Map<string, LoadedUser>> => {
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
	const found = new Map<string, LoadedUser>()
	await Promise.all(
		[...byCollection].map(async ([collection, ids]) => {
			const narrow = await scope?.(collection)
			const byId: Where = { id: { in: [...ids] } }
			const result = await req.payload.find({
				collection: collection as CollectionSlug,
				depth: 0,
				limit: ids.size,
				overrideAccess: true,
				pagination: false,
				req,
				where: narrow ? { and: [byId, narrow] } : byId,
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
 * The candidates who may be mentioned in `channel` of `key`: each passes the
 * channel's `read` rule as themselves, and with `mentions.verifyAccess` also
 * conversation access. Candidates come in already narrowed by
 * `mentions.users`. Returns their keys in the given order.
 */
export const readersAmong = async (
	req: PayloadRequest,
	instance: ConversationsInstance,
	{
		candidates,
		channel,
		key,
	}: { candidates: Array<[string, LoadedUser]>; channel: string; key: string }
): Promise<string[]> => {
	const readable = await Promise.all(
		candidates.map(async ([, user]) => {
			const asUser = await requestAs(req, user)
			if (!(await channelAllows(asUser, instance, { action: 'read', channel }))) {
				return false
			}
			if (!instance.mentions.verifyAccess) {
				return true
			}
			return (await instance.grants(asUser, [key])).get(key)?.read.has(channel) ?? false
		})
	)
	return candidates.filter((_, index) => readable[index]).map(([candidate]) => candidate)
}

/** The scope `mentions.users` gives the sender for one users collection. */
export const mentionScope =
	(
		req: PayloadRequest,
		instance: ConversationsInstance,
		{ channel, key }: { channel: string; key: string }
	) =>
	(collection: string) =>
		instance.mentions.users?.({ channel, collection, key, req })

/**
 * The users among `userKeys` who may be mentioned in `channel` of `key`: one
 * query per users collection with `mentions.users` folded in, then the
 * channel rule per candidate (see `readersAmong`). Backs the `afterMention`
 * promise.
 */
export const filterReaders = async (
	req: PayloadRequest,
	instance: ConversationsInstance,
	{ channel, key, userKeys }: { channel: string; key: string; userKeys: string[] }
): Promise<string[]> => {
	if (!parseKey(key) || !instance.channels.has(channel) || userKeys.length === 0) {
		return []
	}
	const users = await loadUsers(req, instance, {
		scope: mentionScope(req, instance, { channel, key }),
		userKeys,
	})
	return readersAmong(req, instance, {
		candidates: userKeys.flatMap((candidate) => {
			const user = users.get(candidate)
			return user ? [[candidate, user] as [string, LoadedUser]] : []
		}),
		channel,
		key,
	})
}
