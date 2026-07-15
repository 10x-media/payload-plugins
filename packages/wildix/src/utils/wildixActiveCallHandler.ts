import type { CollectionSlug, PayloadHandler } from 'payload'
import type { WildixAccess } from './access'
import { checkAccess } from './access'
import { createActiveCallStore } from './activeCall'

/**
 * Returns the live calls tracked in the KV store, scoped to the requesting user's
 * Wildix extension when a linked account exists. Without a link, all calls are
 * returned (shared-account fallback).
 */
export const wildixActiveCallHandler =
	(access?: WildixAccess, wildixUsersSlug?: string): PayloadHandler =>
	async (req) => {
		const denied = await checkAccess(req, access, 'activeCall')
		if (denied) return denied

		const store = createActiveCallStore(req.payload)
		const all = await store.get()

		if (!wildixUsersSlug || !req.user) {
			return Response.json({ calls: all }, { status: 200 })
		}

		const linked = await req.payload.find({
			collection: wildixUsersSlug as CollectionSlug,
			where: { 'payloadUser.value': { equals: req.user.id } },
			limit: 1,
			depth: 0,
			overrideAccess: true,
		})
		const extension = (linked.docs[0] as Record<string, unknown> | undefined)?.extension as
			| string
			| undefined

		if (!extension) {
			return Response.json({ calls: all }, { status: 200 })
		}

		const calls = all.filter((c) => !c.userExtension || c.userExtension === extension)
		return Response.json({ calls }, { status: 200 })
	}
