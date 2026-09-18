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
 * A scope a request may act on, or why it may not. `named` is a scope the caller asked for
 * and `platformRead` denies; `unresolved` is a request whose own scope is cross-scope, or
 * ambiguous on a scoped install, behind the same gate; `failed` is a `scopeResolver` that
 * threw, which callers that can serve something degraded tell apart from a refusal.
 */
export type RequestedScope =
	| { ok: true; scope: string | null }
	| { ok: false; reason: 'named' | 'unresolved' | 'failed' }

export interface RequestedScopeArgs {
	runtime: AnalyticsRuntime
	req: PayloadRequest
	/** The `scope` the request carried, untrimmed; null or undefined when it carried none. */
	raw?: string | null
	/** Shared `platformRead` decision; one is created per call when omitted. */
	platformRead?: PlatformReadGate
}

/**
 * The scope one request may act on, decided in one place for every endpoint that takes a
 * `scope` from a caller, so a read gate and a state-changing gate cannot drift apart.
 *
 * The raw value is trimmed and a blank one counts as absent, exactly as `readParam` reads a
 * query string. Naming a scope, the platform wildcard included, is the cross-scope decision
 * and requires `platformRead`. Absent means the request's own resolved scope, which is
 * itself cross-scope when the resolver answers the wildcard or, on a scoped install, null:
 * null usually means "no tenant selected" rather than "everything", so it fails closed
 * behind the same gate. A resolver that throws answers no scope either, separately, so a
 * caller with a degraded answer to give can tell it from a refusal. Per-adapter narrowing
 * is a later decision, in `resolveQueryScope`.
 */
export const resolveRequestedScope = async (args: RequestedScopeArgs): Promise<RequestedScope> => {
	const { runtime, req } = args
	const allowed = args.platformRead ?? platformReadGate(runtime, req)
	const named = typeof args.raw === 'string' ? args.raw.trim() : ''
	if (named !== '') {
		return (await allowed()) ? { ok: true, scope: named } : { ok: false, reason: 'named' }
	}
	let scope: string | null
	try {
		scope = await resolveScopeFor(runtime, req)
	} catch (err) {
		req.payload.logger?.warn(`analytics: scope resolution failed: ${String(err)}`)
		return { ok: false, reason: 'failed' }
	}
	const crossScope = scope === PLATFORM_SCOPE || (runtime.scoped === true && scope === null)
	if (crossScope && !(await allowed())) {
		return { ok: false, reason: 'unresolved' }
	}
	return { ok: true, scope }
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
 * by id (or the registry default). A request's own scope goes through
 * `resolveRequestedScope`, the same decision every endpoint that takes a scope
 * reads with, so the widgets cannot drift from them on what a scope may be.
 * Cross-scope reads fail closed behind `platformRead`: an explicit `'*'` scope
 * always, any scoped read through a shared config adapter that cannot narrow the
 * query to one scope (whether or not it is the designated platform adapter), and,
 * on a scoped install, a request that resolves no scope at all. That last case is
 * ambiguous rather than intentionally install-wide (a tenant's scopeResolver
 * returning null usually means "no tenant selected", not "read everything"), so it
 * fails closed the same way. An explicit `scope: null` override bypasses that gate:
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
		let scope: string | null
		if (args.scope !== undefined) {
			scope = args.scope
		} else {
			const requested = await resolveRequestedScope({ runtime, req, platformRead: allowed })
			if (!requested.ok) {
				return { ok: false }
			}
			scope = requested.scope
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
