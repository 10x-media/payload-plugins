import type { Access, Payload, PayloadRequest } from 'payload'
import { isAdminUser } from '../access/adminUser'
import { decideOnce } from '../access/decideOnce'
import type { ResolvedBinding } from '../binding/types'
import { captureRequest } from '../capture/captureRequest'
import type { CacheKeyEpochs } from '../core/cacheKey'
import { type AnalyticsAdapter, type AnalyticsResult, PLATFORM_SCOPE } from '../core/contract'
import type { FetchLike } from '../core/fetch'
import type {
	AnalyticsCountryFlags,
	CaptureGatePolicy,
	CaptureSlotOption,
	CrossScopeAccess,
	ResolvedExclusion,
	ResolvedOptions,
	ScopeCallSite,
	ScopeLabelResolver,
	ScopeListResolver,
	ScopeMemberAccess,
} from '../core/options'
import {
	type AdapterRegistry,
	NO_GRANTS,
	type RegistryResolver,
	type ResolveRegistryArgs,
	type ScopeRegistry,
} from '../core/registry'
import type { ServerEventInput, ServerTrackOptions } from '../core/serverEvent'
import { isRecord } from '../core/values'
import type { GoalsResolver, ResolvedGoal } from '../goals/resolver'
import type { Goal } from '../goals/types'
import type { TrustedPlatform } from '../net/platform'
import type { CacheStore } from '../surfacing/cacheStore'
import type { CacheSweeper } from '../surfacing/cacheSweep'
import type { Engine } from '../surfacing/engine'
import { type EpochStore, epochsFor, INITIAL_EPOCH } from '../surfacing/epoch'
import type { Memo } from '../surfacing/memo'
import { DEFAULT_TIMEZONE } from '../timeframe/tz'
import type { ResolvedAutoCapture, TrackerSkip } from '../tracker/config'
import { onDestroy } from './destroy'
import { requestMemo } from './requestMemo'
import { ANALYTICS_CONFIG_KEY } from './routes'

export interface AnalyticsRuntime {
	registry: AdapterRegistry
	/** Per-scope adapter resolution; absent runtimes fall back to the static registry. */
	resolveRegistry?: RegistryResolver
	/**
	 * Never call directly: ask {@link resolveScopeFor} or {@link resolveCaptureScopeFor}, whose
	 * capture path strips the visitor's identity first. Absent resolves null.
	 */
	resolveScope?: (req: PayloadRequest, callSite: ScopeCallSite) => Promise<string | null>
	/**
	 * `scope.member`, set exactly when the install is scoped. A runtime without one admits nobody
	 * to a tenant scope they did not reach through `access.crossScope`.
	 */
	member?: ScopeMemberAccess
	/** The plugin's reportingTimezone as a resolver; absent runtimes resolve 'UTC'. */
	resolveTimezone?: (req: PayloadRequest, scope?: string | null) => Promise<string>
	/**
	 * The plugin's `revenue.currency` as a resolver; absent runtimes and installs that set
	 * none resolve undefined, and revenue then renders as a plain number.
	 */
	resolveCurrency?: (req: PayloadRequest, scope?: string | null) => Promise<string | undefined>
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
	 * `capture.gate`: whether a slot's tracker waits for the host's consent manager, evaluated
	 * per request-resolved adapter. Absent runtimes hold every slot.
	 */
	captureGate?: CaptureGatePolicy
	/** Browser auto-capture toggles handed to the tracker; absent runtimes default all on. */
	autoCapture?: ResolvedAutoCapture
	/** `capture.skip`, resolved; absent runtimes skip everything it can. */
	captureSkip?: TrackerSkip
	/** Config goals, and the fallback wherever the merged resolution is unavailable. */
	goals?: Goal[]
	/** `goals.purchase`: whether the resolver adds the built-in `purchase` goal. */
	purchaseGoal?: boolean
	/**
	 * Config goals merged with the goals collection for a request's scope. Absent runtimes
	 * fall back to `goals`.
	 */
	resolveGoals?: GoalsResolver['resolve']
	/** The same merge, each goal tagged with where it came from. */
	resolveGoalsDetailed?: GoalsResolver['resolveDetailed']
	/**
	 * The goals a reader's picker lists: collection goals as the collection's read access lets
	 * the request's user see them. Absent runtimes list what `resolveGoalsDetailed` answers.
	 */
	listGoals?: GoalsResolver['listReadable']
	/** The goals a report spanning every scope names its rows by; see `goalNamesFor`. */
	listGoalsAcross?: GoalsResolver['listAcross']
	/** Slug of the goals collection when the install enabled it; the picker links to it. */
	goalsCollectionSlug?: string
	/**
	 * Providers collection when enabled; it makes a scoped install's sources per tenant.
	 * `sourceAccess` picks which documents a tenant reads through, else the collection's read access.
	 */
	providersCollection?: { slug: string; scopeField: string; sourceAccess?: Access }
	/**
	 * Fetch for adapters built from provider documents: every resolved address must be public unless
	 * `providers.hosts.allowPrivateNetwork`.
	 */
	providerFetch?: FetchLike
	/**
	 * Releases what the runtime itself holds once it is retired: the adapters built from provider
	 * documents, then the connections they reached their vendors through.
	 */
	close?: () => Promise<void>
	/**
	 * Records an event from server code, through whichever registered adapter accepts
	 * server events. Rejects with an `AnalyticsTrackError` when none does.
	 */
	track?: (event: ServerEventInput, opts?: ServerTrackOptions) => Promise<void>
	/**
	 * Where the ingest endpoint listens, relative to `routes.api`, lifted from the adapter that
	 * registered one. Absent runtimes fall back to the base's own ingest mount.
	 */
	ingestPath?: string
	/**
	 * `capture.proxy` limits, separate from `cache.timeoutMs` on purpose: that is a per-read deadline
	 * for dashboard queries, this a public request path with different traffic.
	 */
	captureProxy?: { timeoutMs: number; maxBodyBytes: number }
	/** The plugin's `trustedProxyHops`, read wherever a request's client address is. */
	trustedProxyHops?: number
	/** The plugin's `trustedPlatform`, read wherever a request's client address is. */
	trustedPlatform?: TrustedPlatform
	/**
	 * `capture.allowedOrigins`, normalized: the other sites whose pages may POST to the public
	 * capture routes. Absent runtimes admit no cross-site POST at all.
	 */
	allowedOrigins?: ReadonlySet<string>
	/** `capture.exclusion` while the link is on; absent while it is off. */
	exclusion?: ResolvedExclusion
	/**
	 * `access.view`, which also gates handing out the exclusion link the view shows. Absent
	 * runtimes fall back to the read gate alone.
	 */
	viewAccess?: (args: { req: PayloadRequest }) => boolean | Promise<boolean>
	/** True when the app configured `scope.resolve` (scoped install); mirrors `resolved.scoped`. */
	scoped?: boolean
	/** `scope.label`: names the resolved scope in the view's caption. */
	scopeLabel?: ScopeLabelResolver
	/** `scope.list`: the scopes a named refresh may bump. */
	scopeList?: ScopeListResolver
	/** The read cache's collection, when the install keeps its cache there rather than in `cache.store`. */
	cacheCollectionSlug?: string
	/** `countryFlags`, for the server surfaces that draw a flag outside the view. */
	countryFlags?: boolean | AnalyticsCountryFlags
	/**
	 * Ids of the config-time adapters shared by every scope; runtime provider adapters (from the
	 * providers collection or `providers.resolve`) are never in it.
	 */
	configAdapterIds: ReadonlySet<string>
	/**
	 * `access.crossScope`, every gate filled at config time. A gate a runtime leaves out (a test
	 * double, a half-booted install) admits the users of the admin collection.
	 */
	crossScope?: Partial<Record<ScopeDecision, CrossScopeAccess>>
	/**
	 * `access.read`, asked through `readGate` by every read; absent runtimes admit the users of
	 * the admin collection.
	 */
	readAccess?: (args: { req: PayloadRequest }) => boolean | Promise<boolean>
	/** Each bound collection, with the field its documents carry their scope in. */
	bindings: Record<string, ResolvedBinding>
	engine: Engine
	/**
	 * The per-scope refresh epoch the engine keys on, shared with the reads that build their
	 * own keys. Absent runtimes key on the initial token throughout.
	 */
	epoch?: EpochStore
	/**
	 * Provider and goal configuration epoch every cache key carries beside the refresh epoch: a hash
	 * of committed documents, or a token `refreshProviders()` bumps. Absent, one fixed value.
	 */
	configEpoch?: (scope?: string | null) => Promise<string>
	/**
	 * Told by the providers and goals collection hooks which scopes a save touched, so this
	 * instance reads them again as soon as the save commits. Writes nothing.
	 */
	configChanged?: (collection: 'providers' | 'goals', scopes: Iterable<string | null>) => void
	/** `refreshProviders()`: retires a scope's cached reads on every instance. */
	refreshProviders?: (scope: string | null) => Promise<void>
	/**
	 * Whether a scope's own enabled provider documents grant an adapter, decided from their
	 * committed rows alone: nothing is decrypted. Set on an install running the providers collection.
	 */
	providerGranted?: (scope: string | null, adapterId: string) => Promise<boolean>
	/** The instance's in-process memo, the only place a live count is ever kept. */
	memo?: Memo<AnalyticsResult>
	/** Where reads are cached across instances, and what deletes the expired entries. */
	cache?: { store: CacheStore; sweeper: CacheSweeper }
	/** Explicit TTL overrides; when a value is unset the adapter's recommendedTtl applies. */
	ttl: { aggregate?: number; realtime?: number }
	/** Widget period-over-period comparison; false skips the previous-window read. */
	comparison: boolean
	/** The config adapters this runtime attached to its Payload instance; retiring it closes them. */
	adapters?: readonly AnalyticsAdapter[]
}

/**
 * What the plugin leaves under its key in `config.custom`, which never reaches the client: how
 * to build a runtime for one Payload instance, and the boot checks its `onInit` runs.
 */
export interface RuntimeFactory {
	create: (payload: Payload) => AnalyticsRuntime
	validate: (payload: Payload) => Promise<void>
	/** The options resolved at config time, which the admin view renders with. */
	resolved?: ResolvedOptions
}

const isRuntimeFactory = (value: unknown): value is RuntimeFactory =>
	isRecord(value) && typeof value.create === 'function' && typeof value.validate === 'function'

/** The factory a config carries, absent wherever the plugin is not installed or is disabled. */
export const runtimeFactoryOf = (
	config: { custom?: Record<string, unknown> } | undefined
): RuntimeFactory | undefined => {
	const factory = config?.custom?.[ANALYTICS_CONFIG_KEY]
	return isRuntimeFactory(factory) ? factory : undefined
}

/**
 * Stored on the Payload instance (not a module global) so the runtime survives the separate `.`
 * and `/rsc` bundles a consumer loads; `Symbol.for` resolves the same key in both.
 */
const RUNTIME_KEY = Symbol.for('@10x-media/analytics/runtime')

/** Runtimes replaced on this instance whose adapters are still waiting out their grace period. */
const RETIRING_KEY = Symbol.for('@10x-media/analytics/retiring')

/** How long a replaced runtime keeps serving the requests that already hold it. */
export const RUNTIME_RETIRE_GRACE_MS = 30_000

/** A runtime and the exact config object it was built for, which is how a reload is noticed. */
interface RuntimeSlot {
	config: unknown
	runtime: AnalyticsRuntime | undefined
}

const isRuntimeSlot = (value: unknown): value is RuntimeSlot =>
	isRecord(value) && 'config' in value && 'runtime' in value

const slotOf = (payload: Payload): RuntimeSlot | undefined => {
	const slot: unknown = Reflect.get(payload, RUNTIME_KEY)
	return isRuntimeSlot(slot) ? slot : undefined
}

interface Retirement {
	/** Closes the retired adapters now; later calls share the first one's promise. */
	run: () => Promise<void>
}

const retiringOf = (payload: Payload): Set<Retirement> => {
	const existing: unknown = Reflect.get(payload, RETIRING_KEY)
	if (existing instanceof Set) {
		return existing
	}
	const created = new Set<Retirement>()
	Reflect.set(payload, RETIRING_KEY, created)
	return created
}

/** Runs one close, warning rather than throwing so the closes beside it still run. */
const closeOrWarn = async (payload: Payload, what: string, close: () => unknown): Promise<void> => {
	try {
		await close()
	} catch (err) {
		payload.logger?.warn(`analytics: closing ${what} failed: ${String(err)}`)
	}
}

/**
 * After the grace period, closes the retired runtime's resources and every adapter it attached that
 * its successor no longer uses: a shared adapter keeps its buffer and clients.
 */
const retire = (
	payload: Payload,
	retired: AnalyticsRuntime | undefined,
	successor: AnalyticsRuntime | undefined
): void => {
	const kept = new Set(successor?.adapters ?? [])
	const closing = (retired?.adapters ?? []).filter((adapter) => !kept.has(adapter))
	const closeRuntime = retired?.close
	if (closing.length === 0 && !closeRuntime) {
		return
	}
	const pending = retiringOf(payload)
	let timer: ReturnType<typeof setTimeout> | undefined
	let done: Promise<void> | undefined
	const entry: Retirement = {
		run: () => {
			done ??= (async () => {
				clearTimeout(timer)
				pending.delete(entry)
				await Promise.all([
					closeOrWarn(payload, "a replaced runtime's connections", () => closeRuntime?.()),
					...closing.map((adapter) =>
						closeOrWarn(payload, `the "${adapter.id}" adapter of a replaced runtime`, () =>
							adapter.close?.(payload)
						)
					),
				])
			})()
			return done
		},
	}
	pending.add(entry)
	timer = setTimeout(() => void entry.run(), RUNTIME_RETIRE_GRACE_MS)
	timer.unref?.()
}

/** Closes the instance's runtime and every runtime it replaced, at once: the instance is going away. */
const closeRuntimes = async (payload: Payload): Promise<void> => {
	const slot = slotOf(payload)
	if (slot?.runtime) {
		retire(payload, slot.runtime, undefined)
	}
	await settleRetiredRuntimes(payload)
}

/**
 * An instance's runtime, built on first use and rebuilt when `payload.config` changes identity (HMR
 * `reload`); undefined without the plugin. Building one makes `payload.destroy()` close it.
 */
export const getRuntime = (payload: Payload): AnalyticsRuntime | undefined => {
	const slot = slotOf(payload)
	if (slot && slot.config === payload.config) {
		return slot.runtime
	}
	const runtime = runtimeFactoryOf(payload.config)?.create(payload)
	Reflect.set(payload, RUNTIME_KEY, { config: payload.config, runtime })
	if (slot) {
		retire(payload, slot.runtime, runtime)
	}
	if (runtime) {
		onDestroy(payload, () => closeRuntimes(payload))
	}
	return runtime
}

/** The runtime already built for the instance's current config; unlike `getRuntime`, never builds one. */
export const builtRuntime = (payload: Payload): AnalyticsRuntime | undefined => {
	const slot = slotOf(payload)
	return slot && slot.config === payload.config ? slot.runtime : undefined
}

/** Installs a hand-built runtime for the instance's current config, which is what tests need. */
export const setRuntime = (payload: Payload, runtime: AnalyticsRuntime): void => {
	Reflect.set(payload, RUNTIME_KEY, { config: payload.config, runtime })
}

/** Closes every replaced runtime's adapters now rather than after the grace period. */
export const settleRetiredRuntimes = async (payload: Payload): Promise<void> => {
	await Promise.all([...retiringOf(payload)].map((entry) => entry.run()))
}

const scopes = requestMemo<string | null>('scopeResolutions')
const timezones = requestMemo<string>('timezoneResolutions')
const currencies = requestMemo<string | undefined>('currencyResolutions')

/** A memo key per scope argument, where absent (the request's own scope) and null differ. */
const scopeKey = (scope: string | null | undefined): string =>
	scope === undefined ? 'own' : JSON.stringify(scope)

/**
 * The scope a per-scope resolver answers for: no timezone, currency, goal or source belongs to the
 * cross-scope marker, so it reads as install-wide.
 */
export const resolvableScope = <S extends string | null | undefined>(scope: S): S | null =>
	scope === PLATFORM_SCOPE ? null : scope

/**
 * The scope a signed-in reader's or editor's request selected: the `admin` call site, asked of
 * the host's resolver once per request and user however many reads ask.
 */
export const resolveScopeFor = (
	runtime: AnalyticsRuntime,
	req: PayloadRequest
): Promise<string | null> => {
	const resolve = runtime.resolveScope
	if (!resolve) {
		return Promise.resolve(null)
	}
	return scopes(req, {
		owner: runtime,
		key: 'admin',
		compute: async () => {
			try {
				return await resolve(req, 'admin')
			} catch (err) {
				// Said once here rather than by every read the failure reaches.
				req.payload?.logger?.warn?.(`analytics: scope resolution failed: ${String(err)}`)
				throw err
			}
		},
	})
}

/**
 * A visitor hit's scope, asked via {@link captureRequest} so no user, cookie or auth header reaches
 * the resolver: an editor's beacon files under the site, not their admin tenant.
 */
export const resolveCaptureScopeFor = (
	runtime: AnalyticsRuntime,
	req: PayloadRequest
): Promise<string | null> =>
	runtime.resolveScope?.(captureRequest(req), 'capture') ?? Promise.resolve(null)

/** The scope's reporting timezone, asked of the host's resolver once per request, scope and user. */
export const resolveTimezoneFor = (
	runtime: AnalyticsRuntime,
	req: PayloadRequest,
	scope?: string | null
): Promise<string> => {
	const resolve = runtime.resolveTimezone
	return resolve
		? timezones(req, { owner: runtime, key: scopeKey(scope), compute: () => resolve(req, scope) })
		: Promise.resolve(DEFAULT_TIMEZONE)
}

/** The scope's reporting currency, asked of the host's resolver once per request, scope and user. */
export const resolveCurrencyFor = (
	runtime: AnalyticsRuntime,
	req: PayloadRequest,
	scope?: string | null
): Promise<string | undefined> => {
	const resolve = runtime.resolveCurrency
	return resolve
		? currencies(req, { owner: runtime, key: scopeKey(scope), compute: () => resolve(req, scope) })
		: Promise.resolve(undefined)
}

/**
 * Like {@link resolveTimezoneFor} but resolving the request's scope first, for calendar days read
 * before a read begins. UTC without the plugin or when resolution throws.
 */
export const requestTimezone = async (req: PayloadRequest): Promise<string> => {
	const runtime = getRuntime(req.payload)
	if (!runtime) {
		return DEFAULT_TIMEZONE
	}
	try {
		const scope = await resolveScopeFor(runtime, req)
		return await resolveTimezoneFor(runtime, req, resolvableScope(scope))
	} catch {
		return DEFAULT_TIMEZONE
	}
}

/**
 * A request's reporting currency, resolving its scope first. Undefined without the plugin, without
 * a configured currency, or when resolution throws: revenue then renders as a plain number.
 */
export const requestCurrency = async (req: PayloadRequest): Promise<string | undefined> => {
	const runtime = getRuntime(req.payload)
	if (!runtime?.resolveCurrency) {
		return undefined
	}
	try {
		const scope = await resolveScopeFor(runtime, req)
		return await resolveCurrencyFor(runtime, req, resolvableScope(scope))
	} catch {
		return undefined
	}
}

/** The scope's refresh epoch token, the initial one wherever the runtime carries no store. */
export const cacheEpochFor = (runtime: AnalyticsRuntime, scope?: string | null): Promise<string> =>
	runtime.epoch?.get(scope) ?? Promise.resolve(INITIAL_EPOCH)

/** Both epochs the scope's cache keys carry, for a read that builds its own key. */
export const cacheEpochsFor = (
	runtime: AnalyticsRuntime,
	scope?: string | null
): Promise<CacheKeyEpochs> =>
	epochsFor(
		{
			...(runtime.epoch ? { refresh: runtime.epoch } : {}),
			...(runtime.configEpoch ? { config: runtime.configEpoch } : {}),
		},
		scope
	)

/** The scope's adapter registry; without a per-scope resolver, the config one and no grants. */
export const resolveRegistryFor = (
	runtime: AnalyticsRuntime,
	args: ResolveRegistryArgs
): Promise<ScopeRegistry> =>
	runtime.resolveRegistry?.(args) ??
	Promise.resolve({ registry: runtime.registry, grants: NO_GRANTS })

/** The scope's goals: config goals merged with the goals collection, where the runtime can. */
export const resolveGoalsFor = (
	runtime: AnalyticsRuntime,
	req: PayloadRequest,
	scope?: string | null
): Promise<Goal[]> => runtime.resolveGoals?.(req, scope) ?? Promise.resolve(runtime.goals ?? [])

/**
 * {@link resolveGoalsFor}'s goals, each tagged with its origin. Falls back to the untagged
 * resolver, not the static config list, so the two never disagree.
 */
export const resolveGoalsDetailedFor = async (
	runtime: AnalyticsRuntime,
	req: PayloadRequest,
	scope?: string | null
): Promise<ResolvedGoal[]> => {
	if (runtime.resolveGoalsDetailed) {
		return runtime.resolveGoalsDetailed(req, scope)
	}
	const goals = runtime.resolveGoals
		? await runtime.resolveGoals(req, scope)
		: (runtime.goals ?? [])
	return goals.map((goal) => ({ goal, source: 'config' as const }))
}

/**
 * Whether a read in `scope` spans every scope: the aggregate, or the install-wide read a scoped
 * install answers a platform reader who selected no tenant.
 */
const readsAcrossScopes = (
	runtime: Pick<AnalyticsRuntime, 'scoped'>,
	scope: string | null | undefined
): boolean => scope === PLATFORM_SCOPE || ((scope ?? null) === null && runtime.scoped === true)

/**
 * Names a report in `scope` lists goal rows by. A cross-scope report draws on every scope the
 * reader may see, so a foreign goal reads by name; unnamed goals read as slugs.
 */
export const goalNamesFor = async (args: {
	runtime: AnalyticsRuntime
	req: PayloadRequest
	scope: string | null | undefined
	/** The scope's own goals, when the caller already resolved them. */
	resolved?: ResolvedGoal[]
}): Promise<Array<{ slug: string; name: string }>> => {
	const { runtime, req, scope, resolved } = args
	const own = resolved ?? (await resolveGoalsDetailedFor(runtime, req, resolvableScope(scope)))
	if (!readsAcrossScopes(runtime, scope) || !runtime.listGoalsAcross) {
		return own.map(({ goal }) => ({ slug: goal.slug, name: goal.name }))
	}
	const across = await runtime.listGoalsAcross(req)
	const names = new Map(own.map(({ goal }) => [goal.slug, goal.name]))
	for (const { goal } of across) {
		if (!names.has(goal.slug)) {
			names.set(goal.slug, goal.name)
		}
	}
	return [...names].map(([slug, name]) => ({ slug, name }))
}

/** The three cross-scope decisions `access.crossScope` names. */
export type ScopeDecision = 'named' | 'aggregate' | 'unscopedSource'

/**
 * The three cross-scope decisions for one request, each evaluated at most once per user however
 * many gates and reads consult it.
 */
export type ScopeGates = Record<ScopeDecision, () => Promise<boolean>>

/**
 * The request's {@link ScopeGates}; a gate `access.crossScope` leaves unset admits the users of the
 * admin collection.
 */
export const scopeGates = (runtime: AnalyticsRuntime, req: PayloadRequest): ScopeGates => {
	const gate = (decision: ScopeDecision) => (): Promise<boolean> =>
		decideOnce(req, {
			owner: runtime,
			key: `crossScope:${decision}`,
			decide: () => runtime.crossScope?.[decision]?.({ req }) ?? isAdminUser({ req }),
		})
	return {
		named: gate('named'),
		aggregate: gate('aggregate'),
		unscopedSource: gate('unscopedSource'),
	}
}
