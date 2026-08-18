import type { CollectionSlug, SanitizedCollectionConfig } from 'payload'
import { generateCookie, getCookieExpiration } from 'payload/shared'

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
