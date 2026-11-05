import type { PayloadRequest, TypedUser } from 'payload'
import type { ScopeMemberAccess } from '../core/options'
import { isRecord } from '../core/values'
import { decideOnce } from './decideOnce'

export interface TenantMembershipOptions {
	/** The array field on a user listing their tenants. Default `'tenants'`. */
	tenantsArrayFieldName?: string
	/** The relationship to a tenant inside each row of that array. Default `'tenant'`. */
	tenantsArrayTenantFieldName?: string
	/**
	 * Users who belong to every tenant, platform staff for instance. Pass the same function the
	 * multi-tenant plugin's own `userHasAccessToAllTenants` is.
	 */
	userHasAccessToAllTenants?: (user: TypedUser) => boolean
}

const TENANTS_ARRAY_FIELD = 'tenants'
const TENANT_FIELD = 'tenant'

/** A relationship's id, whether it arrived populated (`{ id }`) or as the id itself. */
const relationId = (value: unknown): string | undefined => {
	if (typeof value === 'string' || typeof value === 'number') {
		return String(value)
	}
	if (isRecord(value) && (typeof value.id === 'string' || typeof value.id === 'number')) {
		return String(value.id)
	}
	return undefined
}

/**
 * Tenant ids as `@payloadcms/plugin-multi-tenant` stores them: one array row per tenant, its
 * relationship populated or not; a row without a tenant is skipped.
 */
export const userTenantIds = (
	user: unknown,
	arrayField = TENANTS_ARRAY_FIELD,
	tenantField = TENANT_FIELD
): string[] => {
	if (!isRecord(user)) {
		return []
	}
	const rows = user[arrayField]
	if (!Array.isArray(rows)) {
		return []
	}
	const ids: string[] = []
	for (const row of rows) {
		const id = isRecord(row) ? relationId(row[tenantField]) : undefined
		if (id !== undefined) {
			ids.push(id)
		}
	}
	return ids
}

/**
 * `scope.member` for users carrying tenants as `@payloadcms/plugin-multi-tenant` stores them,
 * without depending on it. Ids compare as strings; `userHasAccessToAllTenants` admits everywhere.
 */
export const tenantMembership = (options: TenantMembershipOptions = {}): ScopeMemberAccess => {
	const arrayField = options.tenantsArrayFieldName || TENANTS_ARRAY_FIELD
	const tenantField = options.tenantsArrayTenantFieldName || TENANT_FIELD
	return ({ req, scope }) => {
		const user = req.user
		if (!user) {
			return false
		}
		if (options.userHasAccessToAllTenants?.(user)) {
			return true
		}
		return userTenantIds(user, arrayField, tenantField).includes(scope)
	}
}

/**
 * Asks `scope.member` at most once per request, scope and user. Without a `member` (only a test
 * double lacks one) nobody belongs, and a check that throws counts as not belonging.
 */
export const isScopeMember = async (
	member: ScopeMemberAccess | undefined,
	req: PayloadRequest,
	scope: string
): Promise<boolean> => {
	if (!member) {
		return false
	}
	try {
		return await decideOnce(req, {
			owner: member,
			key: `member:${scope}`,
			decide: () => member({ req, scope }),
		})
	} catch (err) {
		req.payload?.logger?.warn(
			`analytics: scope.member threw for scope "${scope}", which counts as not belonging: ${String(err)}`
		)
		return false
	}
}
