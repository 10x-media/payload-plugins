import type { PayloadRequest } from 'payload'
import { type SerializedCapabilities, serializeCapabilities } from '../core/capabilities'
import { type AnalyticsAdapter, PLATFORM_SCOPE } from '../core/contract'
import type { AdapterRegistry } from '../core/registry'
import type { QuerySourceRef } from '../query/response'
import {
	type AnalyticsRuntime,
	getRuntime,
	type PlatformReadGate,
	platformReadGate,
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
}

export interface ResolveSourcesArgs {
	/**
	 * Read another scope's sources instead of the request's own. Evaluated behind
	 * `access.platformRead`; a denied override resolves nothing at all.
	 */
	scope?: string | null
	/** Shared `platformRead` decision; one is created per call when omitted. */
	platformRead?: PlatformReadGate
}

const empty = (): RequestSources => ({
	sources: [],
	defaultId: null,
	adapters: new Map(),
	scope: null,
})

const fromRegistry = (args: {
	runtime: AnalyticsRuntime
	registry: AdapterRegistry
	scope: string | null
}): RequestSources => {
	const { runtime, registry, scope } = args
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
	}
}

/**
 * The sources a request may read, resolved once for both read endpoints: the request's
 * own scope (or a trusted explicit one), the per-scope registry, and each adapter's
 * serialized capabilities. Two resolutions are cross-scope and fail closed behind
 * `platformRead`: a scopeResolver answering the `'*'` marker, and, on a scoped install, one
 * answering no scope at all, which is ambiguous rather than install-wide (returning null
 * usually means "no tenant selected"). A failed resolution resolves nothing too, since it is
 * indistinguishable from a forged one. An unscoped install falls back to the static config
 * registry on failure.
 */
export const resolveSourcesForRequest = async (
	req: PayloadRequest,
	args: ResolveSourcesArgs = {}
): Promise<RequestSources> => {
	const runtime = getRuntime(req.payload)
	if (!runtime) {
		return empty()
	}
	const allowed = args.platformRead ?? platformReadGate(runtime, req)
	try {
		let scope: string | null
		if (args.scope !== undefined) {
			if (!(await allowed())) {
				return empty()
			}
			scope = args.scope
		} else {
			scope = await resolveScopeFor(runtime, req)
			const crossScope = scope === PLATFORM_SCOPE || (runtime.scoped && scope === null)
			if (crossScope && !(await allowed())) {
				return empty()
			}
		}
		const registry = await resolveRegistryFor(runtime, {
			payload: req.payload,
			req,
			scope: scope === PLATFORM_SCOPE ? null : scope,
		})
		return fromRegistry({ runtime, registry, scope })
	} catch (err) {
		req.payload.logger?.warn(`analytics: source resolution failed: ${String(err)}`)
		if (runtime.scoped) {
			return empty()
		}
		return fromRegistry({ runtime, registry: runtime.registry, scope: null })
	}
}
