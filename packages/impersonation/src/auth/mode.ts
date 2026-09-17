import type { CollectionSlug, Payload, TypedUser } from 'payload'

import { sharedCookieName } from './cookies'

export type DualSessionHelpers = {
	generateIsolatedAuthCookie: (args: {
		collection: CollectionSlug
		payload: Payload
		token: string
		user?: null | TypedUser
	}) => string
	resolveIsolatedCookieName: (args: {
		collection: CollectionSlug
		payload: Payload
		user?: null | TypedUser
	}) => string | undefined
}

const loadDualSession = async (): Promise<DualSessionHelpers | null> => {
	try {
		const mod = await import('@10x-media/dual-session')
		return {
			generateIsolatedAuthCookie: mod.generateIsolatedAuthCookie,
			resolveIsolatedCookieName: mod.resolveIsolatedCookieName,
		}
	} catch {
		return null
	}
}

/**
 * Parallel only when dual-session isolated this user onto a cookie other than
 * the shared `${cookiePrefix}-token`. A role-split collection returns the shared
 * name for some users, which is swap.
 */
export const resolveMode = async ({
	collection,
	payload,
	user,
}: {
	collection: CollectionSlug
	payload: Payload
	user: TypedUser
}): Promise<{ cookieName: string; isolated: boolean }> => {
	const shared = sharedCookieName(payload.config.cookiePrefix)
	const dual = await loadDualSession()
	if (!dual) {
		return { cookieName: shared, isolated: false }
	}

	try {
		const name = dual.resolveIsolatedCookieName({ collection, payload, user })
		if (name && name !== shared) {
			return { cookieName: name, isolated: true }
		}
	} catch {
		return { cookieName: shared, isolated: false }
	}

	return { cookieName: shared, isolated: false }
}

export const isolatedAuthCookie = async ({
	collection,
	payload,
	token,
	user,
}: {
	collection: CollectionSlug
	payload: Payload
	token: string
	user: TypedUser
}): Promise<string | undefined> => {
	const dual = await loadDualSession()
	if (!dual) {
		return undefined
	}
	try {
		return dual.generateIsolatedAuthCookie({ collection, payload, token, user })
	} catch {
		return undefined
	}
}
