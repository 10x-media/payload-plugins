import type { PayloadRequest } from 'payload'

import type { ConversationsAccessResult, ConversationsInstance, TargetGrant } from '../types'

/** What one user may do on one target, within the channels the target offers. */
export type ResolvedGrant = { create: Set<string>; read: Set<string> }

const within = (value: true | string[], offered: string[]): Set<string> =>
	new Set(value === true ? offered : offered.filter((channel) => value.includes(channel)))

/** One grant against the channels its target offers; writing implies reading. */
export const resolveGrant = (grant: TargetGrant, offered: string[]): ResolvedGrant => {
	if (grant === true || Array.isArray(grant)) {
		const both = within(grant, offered)
		return { create: new Set(both), read: both }
	}
	const read = within(grant.read, offered)
	const create = within(grant.create ?? grant.read, offered)
	return { create: new Set([...create].filter((channel) => read.has(channel))), read }
}

/**
 * The host's access answer as grants per key: a key list means every offered
 * channel, a record maps each key to its grant. Keys that were not asked
 * about, and grants with nothing to read, are dropped.
 */
export const resolveGrants = (
	result: ConversationsAccessResult,
	offered: Map<string, string[]>
): Map<string, ResolvedGrant> => {
	const out = new Map<string, ResolvedGrant>()
	const entries: Array<[string, false | null | TargetGrant | undefined]> = Array.isArray(result)
		? result.map((key) => [key, true])
		: Object.entries(result)
	for (const [key, grant] of entries) {
		const channels = offered.get(key)
		if (!channels || !grant) continue
		const resolved = resolveGrant(grant, channels)
		if (resolved.read.size > 0) out.set(key, resolved)
	}
	return out
}

const memo = new WeakMap<object, Map<string, Promise<boolean>>>()

/**
 * A channel's `read` or `create` rule for this request. The rules depend on
 * the user only, so each runs once per request and channel, whatever the
 * number of keys.
 */
export const channelAllows = (
	req: PayloadRequest,
	instance: ConversationsInstance,
	{ action, channel }: { action: 'create' | 'read'; channel: string }
): Promise<boolean> => {
	const config = instance.channels.get(channel)
	if (!config) return Promise.resolve(false)
	let cache = memo.get(req)
	if (!cache) {
		cache = new Map()
		memo.set(req, cache)
	}
	const id = `${instance.slug}|${channel}|${action}`
	let result = cache.get(id)
	if (!result) {
		result = Promise.resolve(config.access[action]({ channel, req }))
		cache.set(id, result)
	}
	return result
}
