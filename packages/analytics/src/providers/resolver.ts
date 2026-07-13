import type { Where } from 'payload'
import type { AnalyticsAdapter } from '../core/contract'
import {
	type AdapterRegistry,
	createRegistry,
	type RegistryResolver,
	type ResolveRegistryArgs,
} from '../core/registry'
import { adapterFromProviderDoc, type ProviderDoc } from './factory'
import { PROVIDER_SECRET_REVEAL_CONTEXT } from './secrets'

export const PROVIDERS_CACHE_TTL_MS = 30_000

/** Produces the runtime adapters layered onto the static base for one scope. */
export type ProvidersSource = (args: ResolveRegistryArgs) => Promise<AnalyticsAdapter[]>

export interface RegistryBase {
	adapters: AnalyticsAdapter[]
	defaultId?: string
}

/**
 * Overlay runtime adapters onto the static base: a runtime adapter sharing a base
 * adapter's id replaces it in place (the scope's own configuration wins, including
 * for the default), new ids append after the base.
 */
export const combineRegistries = (
	base: RegistryBase,
	extra: AnalyticsAdapter[]
): AdapterRegistry => {
	if (extra.length === 0) {
		return createRegistry(base.adapters, base.defaultId)
	}
	const byId = new Map(extra.map((a) => [a.id, a]))
	const merged = base.adapters.map((a) => byId.get(a.id) ?? a)
	const seen = new Set(merged.map((a) => a.id))
	for (const adapter of extra) {
		if (!seen.has(adapter.id)) {
			merged.push(adapter)
			seen.add(adapter.id)
		}
	}
	return createRegistry(merged, base.defaultId)
}

/**
 * Look up a scope's enabled provider documents and build adapters from them.
 * Reads with `overrideAccess` plus the secret-reveal context (the masking hook
 * runs regardless of access), depth 0, straight through the local API.
 */
export const collectionProvidersSource = (slug: string, scopeField: string): ProvidersSource => {
	return async ({ payload, scope }) => {
		// equals null matches SQL NULL and a missing Mongo key alike; '' covers cleared text.
		const scopeWhere: Where =
			scope === null
				? { or: [{ [scopeField]: { equals: null } }, { [scopeField]: { equals: '' } }] }
				: { [scopeField]: { equals: scope } }
		const { docs } = await payload.find({
			collection: slug as never,
			where: { and: [{ enabled: { equals: true } }, scopeWhere] },
			limit: 100,
			pagination: false,
			depth: 0,
			overrideAccess: true,
			context: { [PROVIDER_SECRET_REVEAL_CONTEXT]: true },
		})
		return (docs as ProviderDoc[])
			.map(adapterFromProviderDoc)
			.filter((a): a is AnalyticsAdapter => a !== null)
	}
}

export interface ScopedRegistryResolver {
	resolver: RegistryResolver
	/** Drops every cached scope registry; wired to the provider collection's change hooks. */
	invalidate: () => void
}

/**
 * Cache resolved registries per scope for a short TTL so widget-heavy dashboards
 * do not re-query the provider collection on every read. Invalidation clears all
 * scopes at once: a document's scope binding can itself change, so per-scope
 * eviction could leave a stale entry under the old scope.
 */
export const createScopedRegistryResolver = (args: {
	base: RegistryBase
	source: ProvidersSource
	ttlMs?: number
}): ScopedRegistryResolver => {
	const ttlMs = args.ttlMs ?? PROVIDERS_CACHE_TTL_MS
	const cache = new Map<string | null, { registry: AdapterRegistry; expiresAt: number }>()
	return {
		resolver: async (resolveArgs) => {
			const now = Date.now()
			const hit = cache.get(resolveArgs.scope)
			if (hit && hit.expiresAt > now) {
				return hit.registry
			}
			const registry = combineRegistries(args.base, await args.source(resolveArgs))
			cache.set(resolveArgs.scope, { registry, expiresAt: now + ttlMs })
			return registry
		},
		invalidate: () => cache.clear(),
	}
}
