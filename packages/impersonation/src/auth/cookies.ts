import type { SanitizedCollectionConfig } from 'payload'
import { generateCookie, generateExpiredPayloadCookie, getCookieExpiration } from 'payload/shared'

type AuthConfig = SanitizedCollectionConfig['auth']

const resolveSameSite = (sameSite: AuthConfig['cookies']['sameSite']) => {
	if (typeof sameSite === 'string') {
		return sameSite
	}
	return sameSite ? ('Strict' as const) : undefined
}

export const sharedCookieName = (cookiePrefix: string) => `${cookiePrefix}-token`

export const writeCookie = ({
	authConfig,
	httpOnly = true,
	name,
	value,
}: {
	authConfig: AuthConfig
	httpOnly?: boolean
	name: string
	value: string
}) =>
	generateCookie<false>({
		name,
		domain: authConfig.cookies.domain ?? undefined,
		expires: getCookieExpiration({ seconds: authConfig.tokenExpiration }),
		httpOnly,
		path: '/',
		returnCookieAsObject: false,
		sameSite: resolveSameSite(authConfig.cookies.sameSite),
		secure: authConfig.cookies.secure,
		value,
	})

export const generateHintCookie = ({
	authConfig,
	name,
	value,
}: {
	authConfig: AuthConfig
	name: string
	value: string
}) => writeCookie({ authConfig, name, value })

export const expireCookie = ({
	authConfig,
	httpOnly = true,
	name,
}: {
	authConfig: AuthConfig
	httpOnly?: boolean
	name: string
}) =>
	generateCookie<false>({
		name,
		domain: authConfig.cookies.domain ?? undefined,
		expires: new Date(Date.now() - 1000),
		httpOnly,
		path: '/',
		returnCookieAsObject: false,
		sameSite: resolveSameSite(authConfig.cookies.sameSite),
		secure: authConfig.cookies.secure,
		value: '',
	})

export const expirePayloadCookie = ({
	authConfig,
	cookiePrefix,
}: {
	authConfig: AuthConfig
	cookiePrefix: string
}) => generateExpiredPayloadCookie({ collectionAuthConfig: authConfig, cookiePrefix })

export const expireCookies = ({
	authConfig,
	cookiePrefix,
	names,
}: {
	authConfig: AuthConfig
	cookiePrefix: string
	names: string[]
}): string[] =>
	names.map((name) =>
		name === sharedCookieName(cookiePrefix)
			? expirePayloadCookie({ authConfig, cookiePrefix })
			: expireCookie({ authConfig, name })
	)
