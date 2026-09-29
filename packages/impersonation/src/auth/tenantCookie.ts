import type { SanitizedCollectionConfig } from 'payload'
import { parseCookies } from 'payload/shared'

import { defaultClearOnSwitch } from '../plugin/constants'
import type { ImpersonationMode, ResolvedOptions } from '../types'
import { expireCookie, writeCookie } from './cookies'

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

const idsFrom = (value: unknown): string[] => {
	if (value == null) {
		return []
	}
	if (Array.isArray(value)) {
		return value.flatMap(idsFrom)
	}
	if (typeof value === 'string' || typeof value === 'number') {
		const id = String(value)
		return TENANT_COOKIE_VALUE.test(id) ? [id] : []
	}
	if (typeof value === 'object') {
		if ('id' in value) {
			return idsFrom((value as { id: unknown }).id)
		}
		if ('value' in value) {
			return idsFrom((value as { value: unknown }).value)
		}
	}
	return []
}

/**
 * `@payloadcms/plugin-multi-tenant` puts assignments on `tenants` (hasMany) and
 * sometimes a single `tenant`. Only a unique readable id is safe to write as the selector.
 */
export const uniqueAssignedTenantId = (user: Record<string, unknown>): string | undefined => {
	const ids = [...new Set([...idsFrom(user.tenants), ...idsFrom(user.tenant)])]
	return ids.length === 1 ? ids[0] : undefined
}

export const startTenantCookies = ({
	authConfig,
	cookiePrefix,
	mode,
	options,
	target,
}: {
	authConfig: AuthConfig
	cookiePrefix: string
	mode: ImpersonationMode
	options: ResolvedOptions
	target: Record<string, unknown>
}): string[] => {
	if (!isManagedTenantCookie(options.cookies.clearOnSwitch, cookiePrefix) || mode === 'parallel') {
		return []
	}
	const assigned = uniqueAssignedTenantId(target)
	if (assigned) {
		return [setTenantCookie({ authConfig, cookiePrefix, value: assigned })]
	}
	return [expireTenantCookie({ authConfig, cookiePrefix })]
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
