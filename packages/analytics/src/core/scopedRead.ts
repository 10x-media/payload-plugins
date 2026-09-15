import type { PayloadRequest } from 'payload'
import {
	type AnalyticsRuntime,
	type PlatformReadGate,
	platformReadGate,
	resolveRegistryFor,
	resolveScopeFor,
} from '../plugin/runtime'
import { type AnalyticsAdapter, PLATFORM_SCOPE } from './contract'

export type ReadContext =
	| {
			ok: true
			adapter: AnalyticsAdapter
			scope: string | null
			/** The scope to stamp on the adapter query; undefined for install-wide reads. */
			queryScope?: string
	  }
	| { ok: false }

export interface ResolveReadContextArgs {
	runtime: AnalyticsRuntime
	req: PayloadRequest
	adapterId?: string
	/** Explicit scope override; undefined resolves via the plugin's scopeResolver. */
	scope?: string | null
}

export interface QueryScopeArgs {
	runtime: AnalyticsRuntime
	req: PayloadRequest
	/** The read's resolved scope; `'*'` is the explicit cross-scope marker. */
	scope: string | null
	adapter: AnalyticsAdapter
	/** Shared `platformRead` decision; one is created per call when omitted. */
	platformRead?: PlatformReadGate
}

/**
 * The scope to stamp on one adapter query, or a refusal. Cross-scope reads fail closed
 * behind `platformRead`: the `'*'` marker, and any scoped read through a shared config
 * adapter that cannot narrow the query to one scope (whether or not it is the designated
 * platform adapter), which would otherwise answer with every scope's data. A tenant's own
 * runtime adapters are never gated. Every read path decides this here, so the widgets and
 * the query endpoint cannot drift apart on what counts as cross-scope.
 */
export const resolveQueryScope = async (
	args: QueryScopeArgs
): Promise<{ ok: true; queryScope?: string } | { ok: false }> => {
	const { runtime, req, scope, adapter } = args
	const allowed = args.platformRead ?? platformReadGate(runtime, req)
	if (scope === PLATFORM_SCOPE) {
		return (await allowed()) ? { ok: true } : { ok: false }
	}
	if (scope === null) {
		return { ok: true }
	}
	if (runtime.configAdapterIds.has(adapter.id) && !adapter.capabilities.scopedQueries) {
		return (await allowed()) ? { ok: true } : { ok: false }
	}
	return { ok: true, queryScope: scope }
}

/**
 * Resolve one read's scope and adapter: explicit scope wins over the request's
 * resolved scope, the registry is resolved per scope, then the adapter is picked
 * by id (or the registry default). Cross-scope reads fail closed behind
 * `platformRead`: an explicit `'*'` scope always, any scoped read through a
 * shared config adapter that cannot narrow the query to one scope (whether or
 * not it is the designated platform adapter), and, on a scoped install, a
 * request that resolves no scope at all. That last case is ambiguous rather
 * than intentionally install-wide (a tenant's scopeResolver returning null
 * usually means "no tenant selected", not "read everything"), so it fails
 * closed the same way. An explicit `scope: null` override bypasses that gate:
 * it is the trusted server-side caller's path (cron passes, tests), never a
 * request's own resolution. A tenant's own runtime adapters are never gated.
 * Any resolution failure (unknown adapter id, a throwing scopeResolver or
 * provider lookup) degrades to `{ ok: false }` so read paths render their
 * unavailable state instead of throwing.
 */
export const resolveReadContext = async (args: ResolveReadContextArgs): Promise<ReadContext> => {
	const { runtime, req, adapterId } = args
	const allowed = platformReadGate(runtime, req)
	try {
		const scope = args.scope !== undefined ? args.scope : await resolveScopeFor(runtime, req)
		if (runtime.scoped && args.scope === undefined && scope === null && !(await allowed())) {
			return { ok: false }
		}
		const registryScope = scope === PLATFORM_SCOPE ? null : scope
		const registry = await resolveRegistryFor(runtime, {
			payload: req.payload,
			req,
			scope: registryScope,
		})
		const adapter = adapterId ? registry.get(adapterId) : registry.default()
		const decision = await resolveQueryScope({
			runtime,
			req,
			scope,
			adapter,
			platformRead: allowed,
		})
		if (!decision.ok) {
			return { ok: false }
		}
		return { ok: true, adapter, scope: registryScope, queryScope: decision.queryScope }
	} catch (err) {
		req.payload.logger?.warn(`analytics: read context resolution failed: ${String(err)}`)
		return { ok: false }
	}
}
