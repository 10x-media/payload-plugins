import type { Payload, PayloadRequest } from 'payload'
import { itemCollectionsOf } from '../binding/report'
import { resolveTrackerConfig } from '../capture/trackerConfig'
import { currentDate, currentTime } from '../core/clock'
import type { AnalyticsResult } from '../core/contract'
import { TASK_SLUGS } from '../core/jobs'
import { monotonicMs } from '../core/monotonic'
import {
	DEFAULT_BINDING_SCOPE_FIELD,
	type ResolvedOptions,
	revenueOffWarning,
	type ScopeCallSite,
	trackerAutoCapture,
	untrustedAddressNotice,
} from '../core/options'
import { type AdapterRegistry, withoutRevenue } from '../core/registry'
import { describeWithCauses } from '../core/sourceErrors'
import { throttled } from '../core/throttle'
import { isRecord } from '../core/values'
import { hostHoldsWriteLock, sqliteTransactionsNotice } from '../db/detachedWrite'
import { configGoalsResolver, createGoalsResolver, type GoalsResolver } from '../goals/resolver'
import { createHeartbeatWatch } from '../maintenance/heartbeat'
import { stateLease, stateStoreOf } from '../maintenance/lease'
import { trackServerEvent } from '../native/ingest/serverTrack'
import { NATIVE_ADAPTER_ID } from '../native/nativeAdapter'
import { createGuardedFetch } from '../net/guardedFetch'
import { configTokenBackend } from '../providers/refresh'
import { createProviderRegistry, type ProviderPlan } from '../providers/registry'
import { emptyTrackerConfig, type TrackerConfigSource } from '../site/getTrackerConfig'
import { createCacheSweeper, SWEEP_LEASE, SWEEP_LEASE_MS } from '../surfacing/cacheSweep'
import { collectionCacheStore } from '../surfacing/collectionCacheStore'
import { type CacheOperation, createEngine } from '../surfacing/engine'
import { createEpochStore } from '../surfacing/epoch'
import { ABANDON_AFTER_MS, createLanes, pooledConcurrency } from '../surfacing/lanes'
import { createMemo } from '../surfacing/memo'
import { collectingPageData } from './buildPhase'
import { type ExpectedCollection, recheckCollections } from './collectionChecks'
import { loadEncrypted } from './encrypted'
import { narrowStatsGlobal } from './jobsAccess'
import { createKeepAlive } from './keepAlive'
import { isProductionBuild } from './peers'
import { assertRoutesReachable } from './routeChecks'
import { type AnalyticsRuntime, getRuntime, type RuntimeFactory } from './runtime'
import { validateScopeField } from './scopeFieldBoot'

/** How often a failing read cache, or a throwing `hooks.afterRead`, is reported, at most. */
const CACHE_WARN_EVERY_MS = 60_000

/** node-postgres' own default for the pool's `max`. */
const PG_DEFAULT_POOL_MAX = 10

/** The host's node-postgres pool size, or undefined on another database. */
const postgresPoolMax = (payload: Payload): number | undefined => {
	const db: unknown = payload.db
	if (!isRecord(db) || db.name !== 'postgres') {
		return undefined
	}
	const pool = db.pool
	const options = isRecord(pool) && isRecord(pool.options) ? pool.options : db.poolOptions
	const max = isRecord(options) ? options.max : undefined
	return typeof max === 'number' && Number.isFinite(max) && max > 0 ? max : PG_DEFAULT_POOL_MAX
}

interface RuntimeFactoryArgs {
	resolved: ResolvedOptions
	/** What the collection checks found worth a warning, said once at init. */
	notices: readonly string[]
	/** The plugin's collections as the boot checked them, held to that again in the assembled config. */
	collections: readonly ExpectedCollection[]
	/** The config registry, with revenue already removed where the install measures no money. */
	registry: AdapterRegistry
	resolveScope: (req: PayloadRequest, callSite: ScopeCallSite) => Promise<string | null>
	resolveTimezone: (req: PayloadRequest, scope?: string | null) => Promise<string>
	resolveCurrency: (req: PayloadRequest, scope?: string | null) => Promise<string | undefined>
}

/** Where the install's runtime provider adapters come from. */
const providerPlanOf = (resolved: ResolvedOptions): ProviderPlan => {
	const { resolve, collection } = resolved.providers
	if (resolve) {
		return { kind: 'resolve', resolve }
	}
	if (!collection.enabled) {
		return { kind: 'static' }
	}
	const nativeAdapter = resolved.adapters.find((adapter) => adapter.id === NATIVE_ADAPTER_ID)
	return {
		kind: 'collection',
		slug: collection.slug,
		scopeField: collection.scopeField,
		...(nativeAdapter ? { nativeAdapter } : {}),
	}
}

/** Config goals merged with the goals collection of one instance, when the install runs it. */
const goalsResolverFor = (
	payload: Payload,
	resolved: ResolvedOptions,
	now: () => number
): GoalsResolver =>
	resolved.goalsCollection.enabled
		? createGoalsResolver({
				payload,
				slug: resolved.goalsCollection.slug,
				scopeField: resolved.goalsCollection.scopeField,
				scoped: resolved.scoped,
				config: resolved.goals,
				purchase: resolved.purchaseGoal,
				now,
			})
		: configGoalsResolver(resolved.goals, resolved.purchaseGoal)

/**
 * Native reads stay out of the global cap, so a slow vendor never queues them; on a scoped install
 * every config adapter serves all scopes, so one scope holds at most half of its lane.
 */
const lanesFor = (payload: Payload, resolved: ResolvedOptions, plan: ProviderPlan) => {
	const { concurrency } = resolved.cache
	const configAdapters = new Set(resolved.adapters)
	const poolMax = postgresPoolMax(payload)
	return createLanes({
		global: concurrency.global,
		perSource: concurrency.perSource,
		local: {
			is: (adapter) => adapter.id === NATIVE_ADAPTER_ID,
			...(poolMax === undefined ? {} : { capacity: pooledConcurrency(poolMax) }),
		},
		...(resolved.scoped ? { shared: (adapter) => configAdapters.has(adapter) } : {}),
		...(plan.kind === 'resolve' ? { rebuilt: (adapter) => !configAdapters.has(adapter) } : {}),
		onAbandon: (adapter) =>
			payload.logger?.warn(
				`analytics: a request to the "${adapter.id}" source ignored its abort signal and was still out ${ABANDON_AFTER_MS / 1000} seconds after its read gave up, so its slot was given back and it counts as a timeout. An adapter must pass ctx.signal (or the signal ctx.upstream hands it) to every request it sends; this is said once per source.`
			),
	})
}

/** The runtime fields config time settled outright, alike for every instance. */
const settledFieldsOf = (args: RuntimeFactoryArgs) => {
	const { resolved } = args
	const providers = resolved.providers.collection
	return {
		registry: args.registry,
		resolveScope: args.resolveScope,
		...(resolved.scope.member ? { member: resolved.scope.member } : {}),
		resolveTimezone: args.resolveTimezone,
		// Only when the install configured one: absent, every read path skips the scope
		// resolution the lookup would have needed and revenue stays a plain number.
		...(resolved.revenue.enabled && resolved.revenue.currency !== undefined
			? { resolveCurrency: args.resolveCurrency }
			: {}),
		platformAdapterId: resolved.platformAdapter,
		captureSlots: resolved.capture.slots,
		capturePaths: resolved.capture.paths,
		captureProxy: resolved.capture.proxy,
		trustedProxyHops: resolved.trustedProxyHops,
		trustedPlatform: resolved.trustedPlatform,
		allowedOrigins: resolved.capture.allowedOrigins,
		...(resolved.capture.exclusion ? { exclusion: resolved.capture.exclusion } : {}),
		captureGate: resolved.capture.gate,
		autoCapture: trackerAutoCapture(
			resolved.capture.autoCapture,
			itemCollectionsOf(resolved.bindings).size > 0
		),
		captureSkip: resolved.capture.skip,
		goals: resolved.goals,
		purchaseGoal: resolved.purchaseGoal,
		...(resolved.goalsCollection.enabled
			? { goalsCollectionSlug: resolved.goalsCollection.slug }
			: {}),
		...(providers.enabled
			? {
					providersCollection: {
						slug: providers.slug,
						scopeField: providers.scopeField,
						...(providers.sourceAccess ? { sourceAccess: providers.sourceAccess } : {}),
					},
				}
			: {}),
		ingestPath: resolved.adapters.find((adapter) => adapter.ingest)?.ingest?.path,
		scoped: resolved.scoped,
		countryFlags: resolved.countryFlags,
		...(resolved.scope.label ? { scopeLabel: resolved.scope.label } : {}),
		...(resolved.scope.list ? { scopeList: resolved.scope.list } : {}),
		...(resolved.cache.store ? {} : { cacheCollectionSlug: resolved.cache.collection.slug }),
		configAdapterIds: new Set(resolved.adapters.map((adapter) => adapter.id)),
		crossScope: resolved.access.crossScope,
		readAccess: resolved.access.read,
		viewAccess: resolved.access.view,
		bindings: resolved.bindings,
		ttl: resolved.cache.ttl,
		comparison: resolved.widgets.comparison,
		adapters: resolved.adapters,
	} satisfies Partial<AnalyticsRuntime>
}

const BINDING_SCOPE_FIELD_REMEDY =
	"name the field this collection's documents carry their tenant in, or set it to false to read the request's own scope"

/** Fails boot on a `scopeField` the assembled config lacks, for every collection naming one. */
const validateScopeFields = (payload: Payload, resolved: ResolvedOptions): void => {
	if (resolved.scoped && resolved.goalsCollection.enabled) {
		validateScopeField(payload, {
			option: 'goals.collection.scopeField',
			slug: resolved.goalsCollection.slug,
			scopeField: resolved.goalsCollection.scopeField,
		})
	}
	if (resolved.scoped && resolved.providers.collection.enabled) {
		validateScopeField(payload, {
			option: 'providers.collection.scopeField',
			slug: resolved.providers.collection.slug,
			scopeField: resolved.providers.collection.scopeField,
		})
	}
	for (const [slug, binding] of Object.entries(resolved.bindings)) {
		if (binding.scopeField === false) {
			continue
		}
		validateScopeField(payload, {
			option: `collections.${slug}.scopeField`,
			slug,
			scopeField: binding.scopeField,
			remedy:
				binding.scopeField === DEFAULT_BINDING_SCOPE_FIELD
					? `"${DEFAULT_BINDING_SCOPE_FIELD}" is the default on a scoped install when scopeField is not set, so ${BINDING_SCOPE_FIELD_REMEDY}`
					: BINDING_SCOPE_FIELD_REMEDY,
		})
	}
}

/**
 * Everything config time settled, turned into a runtime per Payload instance on demand, plus the
 * checks that need the assembled config: other plugins add collections and fields after this one.
 */
export const createRuntimeFactory = (
	args: RuntimeFactoryArgs
): RuntimeFactory & TrackerConfigSource => {
	const { resolved } = args
	const money = resolved.revenue.enabled
	const providers = resolved.providers.collection
	const plan = providerPlanOf(resolved)
	const rechecked = new WeakSet<object>()
	/** The checks only the assembled config can answer, once per config. */
	const checkAssembled = (payload: Payload): void => {
		if (rechecked.has(payload.config)) {
			return
		}
		assertRoutesReachable(resolved.routes.base, payload.config)
		recheckCollections(payload.config.collections ?? [], args.collections, payload.db?.name)
		narrowStatsGlobal(payload)
		rechecked.add(payload.config)
	}
	return {
		create: (payload) => {
			// Here rather than in onInit alone: a worker booted without onInit and an HMR reload build
			// their runtime on first use, from a config other plugins may have changed.
			checkAssembled(payload)
			for (const adapter of resolved.adapters) {
				adapter.attach?.(payload)
			}
			// The adapters a `providers.resolve` builds from editor-written settings need the same
			// guarded connection the collection's own documents get.
			const providerConnections =
				providers.enabled || resolved.providers.resolve
					? createGuardedFetch({
							allowPrivateNetwork: resolved.providers.hosts.allowPrivateNetwork,
							warn: (message) => payload.logger?.warn(message),
						})
					: undefined
			const epoch = createEpochStore(payload)
			const now = currentTime
			const warn = (message: string) => payload.logger?.warn(message)
			const registry = createProviderRegistry({
				payload,
				plan,
				base: { adapters: resolved.adapters, defaultId: resolved.defaultAdapter },
				registry: args.registry,
				narrow: money ? (scoped) => scoped : withoutRevenue,
				hosts: resolved.providers.hosts,
				fetch: providerConnections?.fetch,
				sdks: resolved.sdks,
				...(plan.kind === 'resolve'
					? { tokens: createEpochStore(payload, { now, backend: configTokenBackend(payload) }) }
					: {}),
				now,
			})
			const goals = goalsResolverFor(payload, resolved, now)
			// Only where something can change at runtime; an install configured in code keys every read
			// on the fixed epoch.
			const configEpoch =
				plan.kind === 'static' && !resolved.goalsCollection.enabled
					? undefined
					: async (scope?: string | null): Promise<string> => {
							const [providerEpoch, goalsEpoch] = await Promise.all([
								registry.epoch(scope ?? null),
								goals.epoch(scope),
							])
							return `${providerEpoch}.${goalsEpoch}`
						}
			const store =
				resolved.cache.store ??
				collectionCacheStore(payload, { slug: resolved.cache.collection.slug })
			const memo = createMemo<AnalyticsResult>({ now })
			const sweeper = createCacheSweeper({
				store,
				lease: () => stateLease(payload, SWEEP_LEASE, SWEEP_LEASE_MS),
				now: currentDate,
				warn,
				deferred: () => hostHoldsWriteLock(payload),
			})
			// Sync has no fallback: a runner that stopped is only noticed here, by the reads it leaves stale.
			const { jobs } = resolved
			const syncWatch =
				resolved.sync.enabled && jobs !== false
					? createHeartbeatWatch({
							task: TASK_SLUGS.sync,
							schedule: jobs.sync,
							state: () => stateStoreOf(payload),
							now,
							warn,
						})
					: undefined
			const cacheWarning = throttled(warn, { now: monotonicMs, intervalMs: CACHE_WARN_EVERY_MS })
			const onStoreError = (err: unknown, operation: CacheOperation) => {
				cacheWarning(
					`analytics: the read cache failed to ${operation}, reads go on without it: ${String(err)}`
				)
			}
			const keepAlive = createKeepAlive({
				// biome-ignore lint/plugin/noProcessEnv: Next marks the processes serving its requests, the only ones `after()` works in
				env: process.env,
				warn,
			})
			const afterRead = resolved.hooks.afterRead
			const hookWarning = throttled(warn, { now: monotonicMs, intervalMs: CACHE_WARN_EVERY_MS })
			const engine = createEngine({
				payload,
				store,
				memo,
				lanes: lanesFor(payload, resolved, plan),
				coldReadsPerScope: resolved.cache.concurrency.perScope,
				ttl: resolved.cache.ttl,
				timeoutMs: resolved.cache.timeoutMs,
				epoch,
				...(configEpoch ? { configEpoch } : {}),
				now,
				onError: (err, adapterId) => {
					warn(`analytics: read failed for adapter "${adapterId}": ${describeWithCauses(err)}`)
				},
				onStoreError,
				onWrite: () => sweeper.maybeSweep(),
				...(syncWatch ? { onRead: () => syncWatch.maybeCheck() } : {}),
				keepAlive,
				...(afterRead
					? {
							afterRead,
							onHookError: (err: unknown) =>
								hookWarning(
									`analytics: hooks.afterRead threw, reads are answered without it: ${String(err)}`
								),
						}
					: {}),
			})
			return {
				...settledFieldsOf(args),
				resolveRegistry: registry.resolve,
				...(configEpoch ? { configEpoch } : {}),
				configChanged: (collection, scopes) =>
					collection === 'providers' ? registry.changed(scopes) : goals.changed(scopes),
				refreshProviders: registry.refresh,
				...(registry.granted ? { providerGranted: registry.granted } : {}),
				resolveGoals: goals.resolve,
				resolveGoalsDetailed: goals.resolveDetailed,
				listGoals: goals.listReadable,
				listGoalsAcross: goals.listAcross,
				...(providerConnections ? { providerFetch: providerConnections.fetch } : {}),
				// Refreshes and sweeps still running write to the database, which closes after this.
				close: async () => {
					await Promise.all([engine.close(), sweeper.idle(), syncWatch?.idle()])
					await registry.close()
					await providerConnections?.close()
				},
				track: (event, opts) => trackServerEvent(payload, event, opts),
				engine,
				epoch,
				memo,
				cache: { store, sweeper },
			}
		},
		resolved,
		trackerConfig: async (payload, req, draft) => {
			const runtime = getRuntime(payload)
			return runtime ? resolveTrackerConfig({ runtime, req, draft }) : emptyTrackerConfig(req)
		},
		validate: async (payload) => {
			checkAssembled(payload)
			// `next build` boots once per worker and serves nothing; the server that does says these.
			const warn = collectingPageData()
				? () => undefined
				: (message: string) => payload.logger?.warn(message)
			for (const notice of args.notices) {
				warn(notice)
			}
			if (!resolved.cache.store) {
				await collectionCacheStore(payload, { slug: resolved.cache.collection.slug }).prepare()
			}
			validateScopeFields(payload, resolved)
			if (resolved.providers.collection.enabled) {
				const { validateEncryptedBoot } = await loadEncrypted()
				await validateEncryptedBoot(payload, resolved.providers.collection.encryption?.keys)
			}
			const moneyOff = revenueOffWarning(resolved)
			if (moneyOff) {
				warn(moneyOff)
			}
			const spoofable = untrustedAddressNotice(resolved, isProductionBuild())
			if (spoofable) {
				warn(spoofable)
			}
			const transactions = sqliteTransactionsNotice(payload)
			if (transactions) {
				warn(transactions)
			}
		},
	}
}
