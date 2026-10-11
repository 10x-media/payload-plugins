import type { PayloadRequest } from 'payload'
import { type GatedScope, isGatedScope } from '../access/principal'
import { readGate } from '../access/readGate'
import { type SerializedCapabilities, serializeCapabilities } from '../core/capabilities'
import type { AnalyticsAdapter } from '../core/contract'
import type { AdapterRegistry } from '../core/registry'
import {
	needsUnscopedSourceAccess,
	resolveRequestedScope,
	visibleRegistryFor,
} from '../core/scopedRead'
import type { QuerySourceRef } from '../query/response'
import {
	type AnalyticsRuntime,
	getRuntime,
	resolvableScope,
	resolveRegistryFor,
	type ScopeGates,
	scopeGates,
} from './runtime'

/** One readable source on the wire: its identity plus the capabilities a client gates on. */
export interface RequestSource extends QuerySourceRef {
	capabilities: SerializedCapabilities
}

interface RequestSources {
	/** Wire rows for the resolved scope, in registry order; empty when none resolve. */
	sources: RequestSource[]
	defaultId: string | null
	/** The adapters behind `sources`, for callers that read through them. */
	adapters: ReadonlyMap<string, AnalyticsAdapter>
	/** Scope the sources were resolved for; null is install-wide, `*` is cross-scope. */
	scope: string | null
}

interface ResolveSourcesArgs {
	/**
	 * A scope {@link resolveRequestedScope} already cleared for this request, which replaces this
	 * call's own resolution. Only that helper mints one.
	 */
	scope?: GatedScope
	/** Shared cross-scope decisions; one set is created per call when omitted. */
	gates?: ScopeGates
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
 * Sources that can answer about one scope. Under a tenant scope a shared adapter unable to narrow
 * would report every tenant's numbers, so it is dropped however privileged the reader.
 */
const narrowToScope = (runtime: AnalyticsRuntime, resolved: RequestSources): RequestSources => {
	const scope = resolved.scope
	if (scope === null) {
		return resolved
	}
	const narrowable = resolved.sources.filter((source) => {
		const adapter = resolved.adapters.get(source.id)
		return adapter !== undefined && !needsUnscopedSourceAccess(runtime, adapter, scope)
	})
	if (narrowable.length === resolved.sources.length) {
		return resolved
	}
	const kept = new Set(narrowable.map((source) => source.id))
	return {
		sources: narrowable,
		defaultId:
			resolved.defaultId !== null && kept.has(resolved.defaultId)
				? resolved.defaultId
				: (narrowable[0]?.id ?? null),
		adapters: new Map([...resolved.adapters].filter(([id]) => kept.has(id))),
		scope,
	}
}

/**
 * Sources a request may read, shared by every listing surface. A denied, cross-scope or non-member
 * read lists nothing; a failed resolution lists nothing when scoped, else the config registry.
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
		if (!(await readGate(runtime, req))) {
			return empty()
		}
	} catch (err) {
		req.payload.logger?.warn(`analytics: access.read failed, listing no sources: ${String(err)}`)
		return empty()
	}
	const gates = args.gates ?? scopeGates(runtime, req)
	const degrade = (): RequestSources =>
		runtime.scoped ? empty() : fromRegistry({ runtime, registry: runtime.registry, scope: null })
	try {
		let scope: string | null
		if (args.scope !== undefined) {
			if (!isGatedScope(args.scope)) {
				return empty()
			}
			scope = args.scope.value
		} else {
			const requested = await resolveRequestedScope({ runtime, req, gates })
			if (!requested.ok) {
				return requested.reason === 'failed' ? degrade() : empty()
			}
			scope = requested.scope
		}
		const resolved = await resolveRegistryFor(runtime, {
			payload: req.payload,
			req,
			scope: resolvableScope(scope),
		})
		const registry = await visibleRegistryFor({ runtime, req, resolved, scope, gates })
		return registry
			? narrowToScope(runtime, fromRegistry({ runtime, registry, scope }))
			: { ...empty(), scope }
	} catch (err) {
		req.payload.logger?.warn(`analytics: source resolution failed: ${String(err)}`)
		return degrade()
	}
}
