import { getUserTenantIDs } from '@payloadcms/plugin-multi-tenant/utilities'
import type { CollectionConfig, PayloadRequest, Where } from 'payload'

import { parseKey } from '../src/index'

/** The dev admin: every tenant, like a platform operator. */
export const PLATFORM_EMAIL = 'dev@10xmedia.de'

export const tenants: CollectionConfig = {
	slug: 'tenants',
	admin: { useAsTitle: 'name' },
	fields: [{ name: 'name', type: 'text', required: true }],
}

type TenantUser = { collection?: string; email?: string; id?: number | string; tenant?: unknown }

export const isStaff = (req: PayloadRequest) => req.user?.collection === 'users'

export const isPlatform = (req: PayloadRequest) =>
	isStaff(req) && (req.user as TenantUser | null)?.email === PLATFORM_EMAIL

const idOf = (value: unknown): string =>
	value && typeof value === 'object' && 'id' in value
		? String((value as { id: unknown }).id)
		: String(value ?? '')

/** The tenants a signed-in person belongs to: staff through the plugin's array, customers one. */
export const tenantsOf = (req: PayloadRequest): string[] => {
	const user = req.user as null | TenantUser
	if (!user) return []
	if (user.collection === 'customers') return user.tenant ? [idOf(user.tenant)] : []
	return getUserTenantIDs(req.user as never).map(String)
}

/** A person's tenant, for the mention scope. One query; `null` for targets without one. */
const targetTenant = async (req: PayloadRequest, key: string): Promise<null | string> => {
	const target = parseKey(key)
	if (target?.kind !== 'collection' || target.slug !== 'persons' || !target.id) return null
	const doc = await req.payload.findByID({
		collection: 'persons',
		depth: 0,
		disableErrors: true,
		id: target.id,
		overrideAccess: true,
		req,
	})
	return doc?.tenant ? idOf(doc.tenant) : null
}

/**
 * `mentions.users` for the comments instance: only people of the target's
 * tenant (the platform admin is in every tenant), and customers only when
 * staff write.
 */
export const mentionableInTenant = async ({
	collection,
	key,
	req,
}: {
	collection: string
	key: string
	req: PayloadRequest
}): Promise<Where> => {
	if (collection === 'customers' && !isStaff(req)) return { id: { exists: false } }
	const tenant = await targetTenant(req, key)
	if (!tenant) return {}
	return collection === 'users'
		? { or: [{ 'tenants.tenant': { equals: tenant } }, { email: { equals: PLATFORM_EMAIL } }] }
		: { tenant: { equals: tenant } }
}
