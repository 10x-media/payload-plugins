import type { CollectionSlug, SanitizedCollectionConfig, TypedUser } from 'payload'
import { generateCookie, getCookieExpiration } from 'payload/shared'

import type { ResolvedIsolatedCollection } from '../types'

type AuthConfig = SanitizedCollectionConfig['auth']

/** Mirrors Payload's own `sameSite` normalisation in `generatePayloadCookie`. */
const resolveSameSite = (sameSite: AuthConfig['cookies']['sameSite']) => {
	if (typeof sameSite === 'string') {
		return sameSite
	}
	return sameSite ? ('Strict' as const) : undefined
}

export const getIsolatedCookieName = ({
	cookiePrefix,
	slug,
}: {
	cookiePrefix: string
	slug: CollectionSlug
}) => `${cookiePrefix}-${slug}-token`

/** Payload's config-wide auth cookie, the one every non-isolated session lives in. */
export const getSharedCookieName = (cookiePrefix: string) => `${cookiePrefix}-token`

/**
 * The cookie a given user's session belongs in, or `undefined` when there is no user to
 * ask about.
 *
 * This is the whole of the role-split model: the cookie is a function of the user, not of
 * the collection. Without an `isolate` predicate every session of the collection is
 * isolated, which is the two-collection case. With one, the users it rejects stay on the
 * shared cookie, and because `generateIsolatedCookie` under the shared name reproduces
 * `generatePayloadCookie` exactly, those sessions are indistinguishable from core's.
 */
export const resolveSlotCookieName = ({
	entry,
	sharedName,
	user,
}: {
	entry: Pick<ResolvedIsolatedCollection, 'cookieName' | 'isolate'>
	sharedName: string
	user: null | TypedUser | undefined
}): string | undefined => {
	if (!user) {
		return undefined
	}

	return entry.isolate && !entry.isolate(user) ? sharedName : entry.cookieName
}

/**
 * Same shape as Payload's `generatePayloadCookie`, but with a caller-provided cookie name
 * instead of the config-wide `${cookiePrefix}-token`.
 */
export const generateIsolatedCookie = ({
	authConfig,
	name,
	token,
}: {
	authConfig: AuthConfig
	name: string
	token: string
}) =>
	generateCookie<false>({
		name,
		domain: authConfig.cookies.domain ?? undefined,
		expires: getCookieExpiration({ seconds: authConfig.tokenExpiration }),
		httpOnly: true,
		path: '/',
		returnCookieAsObject: false,
		sameSite: resolveSameSite(authConfig.cookies.sameSite),
		secure: authConfig.cookies.secure,
		value: token,
	})

export const generateExpiredIsolatedCookie = ({
	authConfig,
	name,
}: {
	authConfig: AuthConfig
	name: string
}) =>
	generateCookie<false>({
		name,
		domain: authConfig.cookies.domain ?? undefined,
		expires: new Date(Date.now() - 1000),
		httpOnly: true,
		path: '/',
		returnCookieAsObject: false,
		sameSite: resolveSameSite(authConfig.cookies.sameSite),
		secure: authConfig.cookies.secure,
	})
