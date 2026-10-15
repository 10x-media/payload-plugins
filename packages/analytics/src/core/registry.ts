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
 * One scope's adapters, and which its own provider documents put there. A `native` document grants
 * the config native adapter, so a granted id can name a config adapter.
 */
export interface ScopeRegistry {
	registry: AdapterRegistry
	/** Adapter id to the id of the provider document granting it to this scope. */
	grants: ReadonlyMap<string, string>
	/**
	 * Adapter id granted by the scope's enabled, available provider document flagged the default.
	 * It wins a tenant scope's default over `defaultSource` wherever the reader may read it.
	 */
	defaultGrant?: string
}

/** The grants of a registry no provider document adds to. */
export const NO_GRANTS: ReadonlyMap<string, string> = new Map()

/**
 * The seam every read resolves its adapters through: the config registry for all scopes, with
 * runtime provider sources layered per scope on top.
 */
export type RegistryResolver = (args: ResolveRegistryArgs) => Promise<ScopeRegistry>

/**
 * The registry minus the adapters `keep` rejects, or null when it rejects all. The default survives
 * only if kept.
 */
export const filterRegistry = (
	registry: AdapterRegistry,
	keep: (adapter: AnalyticsAdapter) => boolean
): AdapterRegistry | null => {
	const kept = registry.all().filter(keep)
	if (kept.length === 0) {
		return null
	}
	if (kept.length === registry.all().length) {
		return registry
	}
	const defaultId = registry.default().id
	return createRegistry(kept, kept.some((a) => a.id === defaultId) ? defaultId : undefined)
}

/**
 * Each adapter's copy without revenue, made once: reads reach a source through a lane keyed on the
 * adapter object, so one adapter must narrow to one object however many registries are built.
 */
const withoutRevenueCopies = new WeakMap<AnalyticsAdapter, AnalyticsAdapter>()

const dropRevenue = (adapter: AnalyticsAdapter): AnalyticsAdapter => {
	if (!adapter.capabilities.metrics.has('revenue')) {
		return adapter
	}
	const made = withoutRevenueCopies.get(adapter)
	if (made) {
		return made
	}
	const copy: AnalyticsAdapter = {
		...adapter,
		capabilities: {
			...adapter.capabilities,
			metrics: new Set([...adapter.capabilities.metrics].filter((metric) => metric !== 'revenue')),
		},
	}
	withoutRevenueCopies.set(adapter, copy)
	return copy
}

/**
 * The registry with `revenue` gone from every adapter: the one place an install measuring no money
 * hides the metric from every reader at once.
 */
export const withoutRevenue = (registry: AdapterRegistry): AdapterRegistry => {
	const all = registry.all()
	if (!all.some((adapter) => adapter.capabilities.metrics.has('revenue'))) {
		return registry
	}
	return createRegistry(all.map(dropRevenue), registry.default().id)
}

/** A registry over `adapters`, reading through `defaultId` or else the first when none is named. */
export function createRegistry(adapters: AnalyticsAdapter[], defaultId?: string): AdapterRegistry {
	const [first] = adapters
	if (first === undefined) throw new Error('analytics: at least one adapter is required')
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
