import type { Payload, PayloadRequest } from 'payload'
import type { ResolvedBinding } from '../binding/types'
import type { CaptureSlotOption, ConsentPolicy, ResolvedAutoCapture } from '../core/options'
import type { AdapterRegistry, RegistryResolver, ResolveRegistryArgs } from '../core/registry'
import type { Goal } from '../goals/types'
import type { Engine } from '../surfacing/engine'
import { DEFAULT_TIMEZONE } from '../timeframe/tz'

export interface AnalyticsRuntime {
	registry: AdapterRegistry
	/** Per-scope adapter resolution; absent runtimes fall back to the static registry. */
	resolveRegistry?: RegistryResolver
	/** The plugin's scopeResolver bound at init; absent runtimes resolve null. */
	resolveScope?: (req: PayloadRequest) => Promise<string | null>
	/** The plugin's reportingTimezone bound at init; absent runtimes resolve 'UTC'. */
	resolveTimezone?: (req: PayloadRequest, scope?: string | null) => Promise<string>
	/** Id of the config adapter shared by every scope, when one is designated. */
	platformAdapterId?: string
	/** `capture.slots` overrides naming the adapter that fills each capture slot. */
	captureSlots?: { global?: CaptureSlotOption; tenant?: CaptureSlotOption }
	/**
	 * `capture.paths` overrides for a slot's mount. Unset, the tracker config derives the
	 * runtime proxy mount; set when the slot is served through Next rewrites instead.
	 */
	capturePaths?: { global?: string; tenant?: string }
	/**
	 * Whether a slot's tracker waits for consent, evaluated per request-resolved adapter.
	 * Absent runtimes fall back to the default: no gate for native, one for a vendor.
	 */
	consentFor?: ConsentPolicy
	/** Browser auto-capture toggles handed to the tracker; absent runtimes default all on. */
	autoCapture?: ResolvedAutoCapture
	/** Config goals; the tracker receives their slug and match only. */
	goals?: Goal[]
	/**
	 * Where the ingest endpoint listens, relative to `routes.api`, lifted at init from the
	 * adapter that registered one. Absent runtimes fall back to the default mount.
	 */
	ingestPath?: string
	/**
	 * `capture.proxy` limits for the runtime capture proxy. Deliberately separate from
	 * `cache.timeoutMs`: that is a per-read provider deadline for authenticated dashboard
	 * queries, this is a public request path with entirely different traffic.
	 */
	captureProxy?: { timeoutMs: number; maxBodyBytes: number }
	/** True when the app configured a scopeResolver (scoped install); mirrors `resolved.scoped`. */
	scoped?: boolean
	/**
	 * Ids of the config-time adapters shared by every scope (the ones passed to
	 * `adapters` in plugin options). Runtime provider adapters (resolved per scope
	 * from the providers collection or `providers.resolve`) are never in it.
	 */
	configAdapterIds: ReadonlySet<string>
	/** Gate for cross-scope reads; absent runtimes require an authenticated user. */
	platformRead?: (args: { req: PayloadRequest }) => boolean | Promise<boolean>
	bindings: Record<string, ResolvedBinding>
	engine: Engine
	/** Explicit TTL overrides; when a value is unset the adapter's recommendedTtl applies. */
	ttl: { aggregate?: number; realtime?: number }
	/** Widget period-over-period comparison; false skips the previous-window read. */
	comparison: boolean
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

export const resolveScopeFor = (
	runtime: AnalyticsRuntime,
	req: PayloadRequest
): Promise<string | null> => runtime.resolveScope?.(req) ?? Promise.resolve(null)

export const resolveTimezoneFor = (
	runtime: AnalyticsRuntime,
	req: PayloadRequest,
	scope?: string | null
): Promise<string> => runtime.resolveTimezone?.(req, scope) ?? Promise.resolve(DEFAULT_TIMEZONE)

export const resolveRegistryFor = (
	runtime: AnalyticsRuntime,
	args: ResolveRegistryArgs
): Promise<AdapterRegistry> => runtime.resolveRegistry?.(args) ?? Promise.resolve(runtime.registry)

export const platformReadFor = async (
	runtime: AnalyticsRuntime,
	req: PayloadRequest
): Promise<boolean> =>
	runtime.platformRead ? await runtime.platformRead({ req }) : Boolean(req.user)
