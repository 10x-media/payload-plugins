import type { Payload } from 'payload'
import type { ResolvedBinding } from '../binding/types'
import type { AdapterRegistry } from '../core/registry'
import type { Engine } from '../surfacing/engine'

export interface AnalyticsRuntime {
	registry: AdapterRegistry
	bindings: Record<string, ResolvedBinding>
	engine: Engine
	ttl: { aggregate: number; realtime: number }
}

/**
 * Stored on the Payload instance (not a module global) so the runtime survives the
 * separate `.` and `/rsc` bundles a consumer loads: a server-component bundle that
 * imported its own copy of a module-level map would never see what the plugin wrote.
 * `Symbol.for` keys into the cross-realm global symbol registry, so both bundles
 * resolve the same key on the same `payload` object.
 */
const RUNTIME_KEY = Symbol.for('@10x-media/analytics/runtime')

type RuntimeHost = { [RUNTIME_KEY]?: AnalyticsRuntime }

export const setRuntime = (payload: Payload, runtime: AnalyticsRuntime): void => {
	;(payload as unknown as RuntimeHost)[RUNTIME_KEY] = runtime
}

export const getRuntime = (payload: Payload): AnalyticsRuntime | undefined =>
	(payload as unknown as RuntimeHost)[RUNTIME_KEY]
