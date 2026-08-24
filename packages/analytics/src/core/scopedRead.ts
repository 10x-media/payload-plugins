import type { PayloadRequest } from 'payload'
import {
	type AnalyticsRuntime,
	platformReadFor,
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

/**
 * Resolve one read's scope and adapter: explicit scope wins over the request's
 * resolved scope, the registry is resolved per scope, then the adapter is picked
 * by id (or the registry default). Cross-scope reads fail closed behind
 * `platformRead`: an explicit `'*'` scope always, and any scoped read through a
 * shared config adapter that cannot narrow the query to one scope, whether or
 * not it is the designated platform adapter. A tenant's own runtime adapters
 * are never gated. Any resolution failure (unknown adapter id, a throwing
 * scopeResolver or provider lookup) degrades to `{ ok: false }` so read paths
 * render their unavailable state instead of throwing.
 */
export const resolveReadContext = async (args: ResolveReadContextArgs): Promise<ReadContext> => {
	const { runtime, req, adapterId } = args
	try {
		const scope = args.scope !== undefined ? args.scope : await resolveScopeFor(runtime, req)
		const registryScope = scope === PLATFORM_SCOPE ? null : scope
		const registry = await resolveRegistryFor(runtime, {
			payload: req.payload,
			req,
			scope: registryScope,
		})
		const adapter = adapterId ? registry.get(adapterId) : registry.default()
		if (scope === PLATFORM_SCOPE) {
			if (!(await platformReadFor(runtime, req))) {
				return { ok: false }
			}
			return { ok: true, adapter, scope: null, queryScope: undefined }
		}
		if (
			scope !== null &&
			runtime.configAdapterIds.has(adapter.id) &&
			!adapter.capabilities.scopedQueries
		) {
			if (!(await platformReadFor(runtime, req))) {
				return { ok: false }
			}
			return { ok: true, adapter, scope, queryScope: undefined }
		}
		return { ok: true, adapter, scope, queryScope: scope ?? undefined }
	} catch (err) {
		req.payload.logger?.warn(`analytics: read context resolution failed: ${String(err)}`)
		return { ok: false }
	}
}
