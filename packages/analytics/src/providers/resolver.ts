import type { Where } from 'payload'
import type { AnalyticsAdapter } from '../core/contract'
import type { FetchLike } from '../core/fetch'
import { createRegistry, type ScopeRegistry } from '../core/registry'
import { HostRefusedError } from '../core/sourceErrors'

/** One provider document's adapter, tagged with the document that configured it. */
export interface ProviderAdapter {
	adapter: AnalyticsAdapter
	/** Document id, or the adapter's own id for a `providers.resolve` adapter with no document. */
	docId: string
	/** The document is flagged "Default for this site". */
	isDefault?: boolean
}

export interface RegistryBase {
	adapters: AnalyticsAdapter[]
	defaultId?: string
}

/**
 * Appends document adapters to the config base and records their grants; one sharing a base id (a
 * `native` document) takes its place, keeping the id, default and grant lookups. The first document
 * per id wins; the first flagged document names `defaultGrant`, its adapter granted either way.
 */
export const combineRegistries = (base: RegistryBase, extra: ProviderAdapter[]): ScopeRegistry => {
	const indexById = new Map(base.adapters.map((adapter, index) => [adapter.id, index]))
	const merged = [...base.adapters]
	const grants = new Map<string, string>()
	let defaultGrant: string | undefined
	for (const { adapter, docId, isDefault } of extra) {
		if (isDefault && defaultGrant === undefined) {
			defaultGrant = adapter.id
		}
		if (grants.has(adapter.id)) {
			continue
		}
		grants.set(adapter.id, docId)
		const index = indexById.get(adapter.id)
		if (index === undefined) {
			merged.push(adapter)
		} else {
			merged[index] = adapter
		}
	}
	return {
		registry: createRegistry(merged, base.defaultId),
		grants,
		...(defaultGrant === undefined ? {} : { defaultGrant }),
	}
}

/**
 * One scope's provider documents. '' is not castable on a relationship scope field, so install-wide
 * lookups there resolve config adapters only; readable lookups share this clause.
 */
export const providerScopeWhere = (scopeField: string, scope: string | null): Where =>
	scope === null
		? { or: [{ [scopeField]: { equals: null } }, { [scopeField]: { equals: '' } }] }
		: { [scopeField]: { equals: scope } }

/** A fetch that refuses every request, for an adapter that would otherwise go out unguarded. */
export const noGuardedConnection: FetchLike = async (input) => {
	throw new HostRefusedError(new URL(input).host, 'no guarded connection is available')
}
