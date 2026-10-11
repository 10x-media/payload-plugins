import type { MultiTenancyConfig } from '../types'

/**
 * Whether entries for a collection carry a tenant. With `multiTenancy.collections`
 * that list is the answer; without it, any collection with the tenant field counts
 * unless `excludeCollections` names it. The tenants collection is decided apart,
 * since it is its own tenant.
 */
export const isTenantScoped = (
	slug: string,
	multiTenancy: MultiTenancyConfig,
	hasTenantField: boolean
): boolean =>
	multiTenancy.collections
		? Object.hasOwn(multiTenancy.collections, slug)
		: hasTenantField && !(multiTenancy.excludeCollections ?? []).includes(slug as never)

/** A collection the multi-tenant plugin runs as one document per tenant. */
export const isTenantGlobal = (slug: string, multiTenancy: MultiTenancyConfig): boolean =>
	Boolean(multiTenancy.collections?.[slug as keyof typeof multiTenancy.collections]?.isGlobal)
