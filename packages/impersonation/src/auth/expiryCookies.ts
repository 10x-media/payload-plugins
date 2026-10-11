import type { CollectionSlug, Payload, TypedUser } from 'payload'

import { collectionBySlug } from '../ids'
import { relationOf } from '../session/resolve'
import type { ImpersonationRecord, ResolvedOptions } from '../types'
import { expireCookie, expirePayloadCookie } from './cookies'
import { isolatedCookieNameFor } from './mode'

/**
 * Set-Cookie values for an absolute expiry. Parallel expiry does not clear the
 * shared impersonator token. Swap expiry does, because start overwrote it.
 */
export const absoluteExpiryCookies = async ({
	options,
	payload,
	row,
	sid,
	user,
}: {
	options: ResolvedOptions
	payload: Payload
	row: ImpersonationRecord
	sid: string
	user: TypedUser
}): Promise<string[]> => {
	const impersonator = relationOf(row.impersonator)
	const target = relationOf(row.target)
	const isImpersonatorRequest = sid === row.impersonatorSid && sid !== row.targetSid
	const targetAuth = target ? collectionBySlug(payload, target.collection)?.config.auth : undefined
	const impersonatorAuth =
		(impersonator && collectionBySlug(payload, impersonator.collection)?.config.auth) ||
		collectionBySlug(payload, payload.config.admin.user)?.config.auth
	const cookieAuth = targetAuth ?? impersonatorAuth
	if (!cookieAuth) {
		return []
	}

	const cookies = [expireCookie({ authConfig: cookieAuth, name: options.hintCookieName })]

	if (row.mode === 'parallel' && target && targetAuth) {
		const slotUser = isImpersonatorRequest ? await findSlotUser(payload, target) : user
		const isolatedName = await isolatedCookieNameFor({
			collection: target.collection as CollectionSlug,
			payload,
			user: slotUser,
		})
		if (isolatedName) {
			cookies.push(expireCookie({ authConfig: targetAuth, name: isolatedName }))
		}
		return cookies
	}

	if (impersonatorAuth) {
		cookies.push(
			expirePayloadCookie({
				authConfig: impersonatorAuth,
				cookiePrefix: payload.config.cookiePrefix,
			})
		)
	}
	return cookies
}

const findSlotUser = async (
	payload: Payload,
	target: { collection: string; id: number | string }
): Promise<TypedUser> => {
	try {
		return (await payload.findByID({
			id: target.id,
			collection: target.collection as CollectionSlug,
			depth: 0,
			overrideAccess: true,
		})) as TypedUser
	} catch {
		return { collection: target.collection, id: target.id } as TypedUser
	}
}
