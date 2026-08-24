import { createLocalReq, type Where } from 'payload'
import type { AnalyticsAdapter } from '../core/contract'
import {
	type AdapterRegistry,
	createRegistry,
	type RegistryResolver,
	type ResolveRegistryArgs,
} from '../core/registry'
import { adapterFromProviderDoc, type ProviderDoc } from './factory'
import { SECRET_PATHS } from './secrets'

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

const setAtPath = (doc: Record<string, unknown>, path: string, value: unknown): void => {
	const [group, field] = path.split('.') as [string, string]
	const target = doc[group]
	if (target && typeof target === 'object') {
		;(target as Record<string, unknown>)[field] = value
	}
}

const getAtPath = (doc: Record<string, unknown>, path: string): unknown => {
	const [group, field] = path.split('.') as [string, string]
	const target = doc[group]
	return target && typeof target === 'object'
		? (target as Record<string, unknown>)[field]
		: undefined
}

/**
 * Look up a scope's enabled provider documents and build adapters from them.
 * Reads raw ciphertext inside a withRawEncrypted window (write-only secrets
 * are stripped from ordinary reads), then decrypts each credential through
 * the fields key ring. Legacy plaintext rows pass through decryptFieldValue
 * unchanged, so pre-encryption documents keep working until re-saved.
 */
export const collectionProvidersSource = (slug: string, scopeField: string): ProvidersSource => {
	return async ({ payload, req, scope }) => {
		const { decryptFieldValue, withRawEncrypted } = await import('@10x-media/fields/encrypted')
		const readReq = req ?? (await createLocalReq({}, payload))
		const scopeWhere: Where =
			scope === null
				? { or: [{ [scopeField]: { equals: null } }, { [scopeField]: { equals: '' } }] }
				: { [scopeField]: { equals: scope } }
		const { docs } = await withRawEncrypted(readReq, () =>
			payload.find({
				collection: slug as never,
				where: { and: [{ enabled: { equals: true } }, scopeWhere] },
				limit: 100,
				pagination: false,
				depth: 0,
				overrideAccess: true,
				req: readReq,
			})
		)
		const adapters: AnalyticsAdapter[] = []
		for (const raw of docs as Array<Record<string, unknown>>) {
			try {
				const doc = structuredClone(raw) as Record<string, unknown>
				for (const { path } of SECRET_PATHS) {
					const value = getAtPath(doc, path)
					if (typeof value === 'string' && value !== '') {
						const plain = await decryptFieldValue(payload, { collection: slug, path, value })
						setAtPath(doc, path, typeof plain === 'string' ? plain : '')
					}
				}
				const adapter = adapterFromProviderDoc(doc as ProviderDoc)
				if (adapter) adapters.push(adapter)
			} catch (err) {
				// A corrupted or key-rotated-away ciphertext must not take the whole
				// scope's registry down; skip just this document's adapter.
				payload.logger.warn(
					`analytics: provider document "${String(raw.id)}" (${String(raw.provider)}) failed to decrypt, skipping it: ${String(err)}`
				)
			}
		}
		return adapters
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
