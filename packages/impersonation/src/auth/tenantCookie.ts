import type { SanitizedCollectionConfig } from 'payload'
import { parseCookies } from 'payload/shared'

import { defaultClearOnSwitch } from '../plugin/constants'
import type { ImpersonationMode, ResolvedOptions } from '../types'
import { expireCookie, expireCookies, writeCookie } from './cookies'

type AuthConfig = SanitizedCollectionConfig['auth']

/** Same charset Payload tenant ids use (ObjectId, int, uuid). Rejects cookie injection. */
const TENANT_COOKIE_VALUE = /^[\w.-]{1,128}$/

export const tenantCookieName = (cookiePrefix: string): string =>
	defaultClearOnSwitch(cookiePrefix)[0] as string

export const isManagedTenantCookie = (clearOnSwitch: string[], cookiePrefix: string): boolean =>
	clearOnSwitch.includes(tenantCookieName(cookiePrefix))

export const clearOnSwitchWithoutTenant = (
	clearOnSwitch: string[],
	cookiePrefix: string
): string[] => clearOnSwitch.filter((name) => name !== tenantCookieName(cookiePrefix))

export const readTenantCookie = (headers: Headers, cookiePrefix: string): string | undefined => {
	const raw = parseCookies(headers).get(tenantCookieName(cookiePrefix))
	return raw && TENANT_COOKIE_VALUE.test(raw) ? raw : undefined
}

export const setTenantCookie = ({
	authConfig,
	cookiePrefix,
	value,
}: {
	authConfig: AuthConfig
	cookiePrefix: string
	value: string
}): string =>
	writeCookie({
		authConfig,
		httpOnly: false,
		name: tenantCookieName(cookiePrefix),
		value,
	})

/** Client-readable selector. An HttpOnly expiry does not replace it. */
export const expireTenantCookie = ({
	authConfig,
	cookiePrefix,
}: {
	authConfig: AuthConfig
	cookiePrefix: string
}): string =>
	expireCookie({
		authConfig,
		httpOnly: false,
		name: tenantCookieName(cookiePrefix),
	})

/** Parallel keeps these. They are origin-wide, and the impersonator session did not change. */
export const clearCookiesOnStart = ({
	authConfig,
	cookiePrefix,
	except,
	mode,
	options,
}: {
	authConfig: AuthConfig
	cookiePrefix: string
	except: string[]
	mode: ImpersonationMode
	options: ResolvedOptions
}): string[] => {
	if (mode === 'parallel') {
		return []
	}
	const tenant = isManagedTenantCookie(options.cookies.clearOnSwitch, cookiePrefix)
		? [expireTenantCookie({ authConfig, cookiePrefix })]
		: []
	return [
		...tenant,
		...expireCookies({
			authConfig,
			cookiePrefix,
			names: clearOnSwitchWithoutTenant(options.cookies.clearOnSwitch, cookiePrefix).filter(
				(name) => !except.includes(name)
			),
		}),
	]
}

export const exitTenantCookies = ({
	authConfig,
	cookiePrefix,
	mode,
	options,
	snapshot,
}: {
	authConfig: AuthConfig
	cookiePrefix: string
	mode: ImpersonationMode
	options: ResolvedOptions
	snapshot?: null | string
}): string[] => {
	if (!isManagedTenantCookie(options.cookies.clearOnSwitch, cookiePrefix) || mode === 'parallel') {
		return []
	}
	if (snapshot && TENANT_COOKIE_VALUE.test(snapshot)) {
		return [setTenantCookie({ authConfig, cookiePrefix, value: snapshot })]
	}
	return [expireTenantCookie({ authConfig, cookiePrefix })]
}
