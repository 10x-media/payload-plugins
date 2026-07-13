import type { Payload, PayloadRequest } from 'payload'
import type { AnalyticsAdapter } from './contract'

export interface AdapterRegistry {
	get(id: string): AnalyticsAdapter
	default(): AnalyticsAdapter
	all(): AnalyticsAdapter[]
	isMultiProvider(): boolean
}

export type ResolveRegistryArgs = {
	payload: Payload
	req?: PayloadRequest
	/** The analytics boundary to resolve adapters for; null is the whole install. */
	scope: string | null
}

/**
 * The seam every read path resolves its adapters through. The static config
 * registry is the base for all scopes; runtime provider sources (collection,
 * `providers.resolve`) layer per-scope adapters on top of it.
 */
export type RegistryResolver = (args: ResolveRegistryArgs) => Promise<AdapterRegistry>

/** Wrap a config-time registry as a resolver: every scope sees the same adapters. */
export const staticRegistryResolver =
	(registry: AdapterRegistry): RegistryResolver =>
	() =>
		Promise.resolve(registry)

export function createRegistry(adapters: AnalyticsAdapter[], defaultId?: string): AdapterRegistry {
	if (adapters.length === 0) throw new Error('analytics: at least one adapter is required')
	const first = adapters[0] as AnalyticsAdapter
	const byId = new Map(adapters.map((a) => [a.id, a]))
	if (defaultId !== undefined && !byId.has(defaultId)) {
		throw new Error(`analytics: unknown default adapter "${defaultId}"`)
	}
	const fallback = defaultId ?? first.id
	return {
		get(id) {
			const a = byId.get(id)
			if (!a) throw new Error(`analytics: unknown adapter "${id}"`)
			return a
		},
		default: () => byId.get(fallback) ?? first,
		all: () => adapters,
		isMultiProvider: () => adapters.length > 1,
	}
}
