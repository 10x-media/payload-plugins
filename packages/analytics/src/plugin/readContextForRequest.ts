import type { PayloadRequest } from 'payload'
import { type SerializedCapabilities, serializeCapabilities } from '../core/capabilities'
import { type AnalyticsAdapter, PLATFORM_SCOPE } from '../core/contract'
import type { AdapterRegistry } from '../core/registry'
import type { QuerySourceRef } from '../query/response'
import {
	type AnalyticsRuntime,
	getRuntime,
	platformReadFor,
	resolveRegistryFor,
	resolveScopeFor,
} from './runtime'

/** One readable source on the wire: its identity plus the capabilities a client gates on. */
export interface RequestSource extends QuerySourceRef {
	capabilities: SerializedCapabilities
}

export interface RequestSources {
	/** Wire rows for the resolved scope, in registry order; empty when none resolve. */
	sources: RequestSource[]
	defaultId: string | null
	/** The adapters behind `sources`, for callers that read through them. */
	adapters: ReadonlyMap<string, AnalyticsAdapter>
	/** Scope the sources were resolved for; null is install-wide, `*` is cross-scope. */
	scope: string | null
	/**
	 * Whether `access.platformRead` granted this request. Evaluated only where it decides
	 * the answer (an explicit scope, or a null scope on a scoped install), so `false`
	 * elsewhere means "not asked", not "denied".
	 */
	trusted: boolean
}

export interface ResolveSourcesArgs {
	/**
	 * Read another scope's sources instead of the request's own. Evaluated behind
	 * `access.platformRead`; a denied override resolves nothing at all.
	 */
	scope?: string | null
}

const empty = (): RequestSources => ({
	sources: [],
	defaultId: null,
	adapters: new Map(),
	scope: null,
	trusted: false,
})

const fromRegistry = (args: {
	runtime: AnalyticsRuntime
	registry: AdapterRegistry
	scope: string | null
	trusted: boolean
}): RequestSources => {
	const { runtime, registry, scope, trusted } = args
	const adapters = registry.all()
	return {
		sources: adapters.map((adapter) => ({
			id: adapter.id,
			label: adapter.label,
			kind: runtime.configAdapterIds.has(adapter.id) ? ('config' as const) : ('runtime' as const),
			capabilities: serializeCapabilities(adapter.capabilities),
		})),
		defaultId: registry.default().id,
		adapters: new Map(adapters.map((adapter) => [adapter.id, adapter])),
		scope,
		trusted,
	}
}

/**
 * The sources a request may read, resolved once for both read endpoints: the request's
 * own scope (or a trusted explicit one), the per-scope registry, and each adapter's
 * serialized capabilities. On a scoped install a request that resolves no scope at all is
 * ambiguous rather than install-wide (a tenant's scopeResolver returning null usually
 * means "no tenant selected"), so it resolves nothing unless `platformRead` grants it,
 * and a failed resolution resolves nothing too, since it is indistinguishable from a
 * forged one. An unscoped install falls back to the static config registry on failure.
 */
export const resolveSourcesForRequest = async (
	req: PayloadRequest,
	args: ResolveSourcesArgs = {}
): Promise<RequestSources> => {
	const runtime = getRuntime(req.payload)
	if (!runtime) {
		return empty()
	}
	try {
		let trusted = false
		let scope: string | null
		if (args.scope !== undefined) {
			trusted = await platformReadFor(runtime, req)
			if (!trusted) {
				return empty()
			}
			scope = args.scope
		} else {
			scope = await resolveScopeFor(runtime, req)
			if (runtime.scoped && scope === null) {
				trusted = await platformReadFor(runtime, req)
				if (!trusted) {
					return empty()
				}
			}
		}
		const registry = await resolveRegistryFor(runtime, {
			payload: req.payload,
			req,
			scope: scope === PLATFORM_SCOPE ? null : scope,
		})
		return fromRegistry({ runtime, registry, scope, trusted })
	} catch (err) {
		req.payload.logger?.warn(`analytics: source resolution failed: ${String(err)}`)
		if (runtime.scoped) {
			return empty()
		}
		return fromRegistry({ runtime, registry: runtime.registry, scope: null, trusted: false })
	}
}
