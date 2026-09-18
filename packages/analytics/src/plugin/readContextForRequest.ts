import type { PayloadRequest } from 'payload'
import { type SerializedCapabilities, serializeCapabilities } from '../core/capabilities'
import { type AnalyticsAdapter, PLATFORM_SCOPE } from '../core/contract'
import type { AdapterRegistry } from '../core/registry'
import { resolveRequestedScope } from '../core/scopedRead'
import type { QuerySourceRef } from '../query/response'
import {
	type AnalyticsRuntime,
	getRuntime,
	type PlatformReadGate,
	platformReadGate,
	resolveRegistryFor,
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
	 * A scope {@link resolveRequestedScope} already decided and gated for this request. It
	 * replaces this call's own resolution, so pass only what that helper returned.
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
 * own scope (or one a caller already had gated), the per-scope registry, and each adapter's
 * serialized capabilities. {@link resolveRequestedScope} owns the scope decision, so a
 * cross-scope resolution resolves no sources at all rather than another tenant's. A
 * resolution that fails outright degrades instead: nothing on a scoped install, where it is
 * indistinguishable from a forged request, and the static config registry otherwise.
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
	const degrade = (): RequestSources =>
		runtime.scoped ? empty() : fromRegistry({ runtime, registry: runtime.registry, scope: null })
	try {
		let scope: string | null
		if (args.scope !== undefined) {
			scope = args.scope
		} else {
			const requested = await resolveRequestedScope({ runtime, req, platformRead: allowed })
			if (!requested.ok) {
				return requested.reason === 'failed' ? degrade() : empty()
			}
			scope = requested.scope
		}
		const registry = await resolveRegistryFor(runtime, {
			payload: req.payload,
			req,
			scope: scope === PLATFORM_SCOPE ? null : scope,
		})
		return fromRegistry({ runtime, registry, scope })
	} catch (err) {
		req.payload.logger?.warn(`analytics: source resolution failed: ${String(err)}`)
		return degrade()
	}
}
