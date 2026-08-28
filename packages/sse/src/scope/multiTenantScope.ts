import type { PayloadRequest } from 'payload'
import { isNumber, parseCookies } from 'payload/shared'

import { SCOPE_WILDCARD, type SSEScopeOptions } from './types'

export type MultiTenantScopeOptions = {
	/** Tenants collection slug. Default `tenants`. */
	tenantsSlug?: string
	/** Tenant relationship field on scoped collections. Default `tenant`. */
	tenantField?: string
	/** Array field on the user that lists assigned tenants. Default `tenants`. */
	userTenantsField?: string
	/** Relationship field inside each user-tenants row. Default `tenant`. */
	userTenantsRowField?: string
	/** When true, `resolveRequest` returns the wildcard instead of assigned tenants. */
	userHasAccessToAllTenants?: (user: unknown) => boolean
}

const extractId = (value: unknown): string | null => {
	if (value == null) return null
	if (typeof value === 'string' && value.length > 0) return value
	if (typeof value === 'number' && Number.isFinite(value)) return String(value)
	if (typeof value === 'object' && 'id' in value) {
		return extractId((value as { id: unknown }).id)
	}
	return null
}

const tenantsIdType = (req: PayloadRequest, tenantsSlug: string): 'text' | 'number' => {
	const custom = req.payload.collections[tenantsSlug]?.customIDType
	if (custom === 'number' || custom === 'text') return custom
	const fallback = req.payload.db.defaultIDType
	return fallback === 'number' ? 'number' : 'text'
}

const cookieTenant = (req: PayloadRequest, tenantsSlug: string): string | null => {
	const raw = parseCookies(req.headers).get('payload-tenant')
	if (!raw) return null
	if (tenantsIdType(req, tenantsSlug) === 'number' && isNumber(raw)) {
		return String(parseFloat(raw))
	}
	return raw
}

const assignedTenantIds = (
	user: unknown,
	userTenantsField: string,
	userTenantsRowField: string
): string[] => {
	if (!user || typeof user !== 'object') return []
	const rows = (user as Record<string, unknown>)[userTenantsField]
	if (!Array.isArray(rows)) return []
	const ids: string[] = []
	for (const row of rows) {
		if (row == null) continue
		const value =
			typeof row === 'object' && userTenantsRowField in row
				? (row as Record<string, unknown>)[userTenantsRowField]
				: row
		const id = extractId(value)
		if (id) ids.push(id)
	}
	return ids
}

/**
 * Scope resolvers for `@payloadcms/plugin-multi-tenant`.
 * Cookie is a selector among assigned tenants (or any tenant when the
 * wildcard callback is true). Unassigned cookie values are refused.
 * Soft: uses `parseCookies` from `payload/shared`, no plugin import.
 */
export const multiTenantScope = (options: MultiTenantScopeOptions = {}): SSEScopeOptions => {
	const tenantsSlug = options.tenantsSlug ?? 'tenants'
	const tenantField = options.tenantField ?? 'tenant'
	const userTenantsField = options.userTenantsField ?? 'tenants'
	const userTenantsRowField = options.userTenantsRowField ?? 'tenant'
	const userHasAccessToAllTenants = options.userHasAccessToAllTenants

	return {
		resolveRequest: ({ req }) => {
			const assigned = assignedTenantIds(req.user, userTenantsField, userTenantsRowField)
			const fromCookie = cookieTenant(req, tenantsSlug)
			if (fromCookie) {
				if (assigned.includes(fromCookie) || userHasAccessToAllTenants?.(req.user)) {
					return fromCookie
				}
				return null
			}

			if (userHasAccessToAllTenants?.(req.user)) {
				return SCOPE_WILDCARD
			}

			if (assigned.length === 1) return assigned[0] ?? null
			if (assigned.length > 1) return assigned
			return null
		},
		resolveDoc: ({ doc }) => {
			if (!doc || typeof doc !== 'object') return null
			return extractId((doc as Record<string, unknown>)[tenantField])
		},
	}
}
