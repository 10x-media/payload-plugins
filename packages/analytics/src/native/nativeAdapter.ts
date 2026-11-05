import {
	type Config,
	createLocalReq,
	type Payload,
	type PayloadHandler,
	type PayloadRequest,
} from 'payload'
import { captureRequest } from '../capture/captureRequest'
import { adapterWithoutConsent, cookielessCapture } from '../capture/withoutConsent'
import type { CaptureSupport } from '../core/capture'
import { currentDate } from '../core/clock'
import {
	type AnalyticsCollectionOptions,
	type ResolvedCollectionOption,
	resolveCollectionOption,
} from '../core/collectionOption'
import type {
	AdapterContext,
	AdapterRegisterContext,
	AdapterSchemaContext,
	AnalyticsAdapter,
	AnalyticsCapabilities,
	AnalyticsQuery,
	AnalyticsResult,
} from '../core/contract'
import { type AdapterJobs, DEFAULT_JOBS } from '../core/jobs'
import { assertNoLegacyOptions, LEGACY_NATIVE_OPTIONS } from '../core/legacyOptions'
import type { MaxmindSdk } from '../core/sdks'
import type { IngestHostnameResolver } from '../core/serverEvent'
import { type AdapterLabelOption, adapterLabel } from '../core/sourceLabel'
import { isRecord, kindOf } from '../core/values'
import { dbKind, isD1 } from '../db/kind'
import { DEFAULT_ORDER_SIGNATURE } from '../goals/match'
import { itemIdTypes } from '../items/collectionIdType'
import { shapeCollection } from '../plugin/collectionChecks'
import { isDestroyed } from '../plugin/destroy'
import { createKeepAlive } from '../plugin/keepAlive'
import { isProductionBuild, MAXMIND_SDK_WARNING } from '../plugin/peers'
import { DEFAULT_ROUTE_BASE, routePaths } from '../plugin/routes'
import { getRuntime } from '../plugin/runtime'
import { addTask, schemaOnlyTask } from '../plugin/schemaOnly'
import { TASK_SWEEP_BATCHES } from '../surfacing/cacheSweep'
import type { WithoutConsentLevel } from '../tracker/config'
import { aggregatesCollection } from './collections/aggregates'
import { hitsCollection } from './collections/hits'
import { DEFAULT_STORE_SLUGS, type StoreSlugs } from './collections/slugs'
import { stateCollection } from './collections/state'
import { DEFAULT_RAW_DAYS, nativeCapabilities } from './engine/capabilities'
import { createEngine } from './engine/engine'
import { closeNativeInstance, type NativeInstance, nativeInstanceFor } from './engine/instance'
import type { RebuildDaysInput, RebuildDaysReport } from './engine/rebuild'
import { createDailySalts } from './engine/salt'
import { createSiteHosts } from './engine/siteHosts'
import { createHitWriter, resolveWriteBuffer, type WriteBufferOption } from './engine/writeBuffer'
import { composeGeoResolvers } from './geo/composeGeoResolvers'
import { type GeoResolver, needsMaxmindSdk, platformHeaderResolver } from './geo/geoResolver'
import { maxmindResolver } from './geo/maxmindResolver'
import { type BotFilter, resolveBotFilter } from './ingest/bots'
import { type IngestAttribution, type IngestResolvers, makeIngestHandler } from './ingest/endpoint'
import { type ItemSignatureMode, itemRefKey } from './ingest/itemSignature'
import type { ItemIngestOptions } from './ingest/normalizeEvent'
import { orderRefKey } from './ingest/orderSignature'
import {
	type HostnameOption,
	hostnameSet,
	resolveEventHostname,
	resolveHostnameOption,
} from './ingest/resolveHostname'
import { makeServerTrack } from './ingest/serverTrack'
import { type CapsOption, resolveCaps } from './store/caps'
import { createEventStore } from './store/eventStore'
import { TWIN_WINDOW_MS } from './store/hits'
import { rawFilterMap } from './store/rawRead'
import { createSqlExecutor } from './store/sql/executor'
import { isSqliteThread, SQLITE_THREADS, type SqliteThread } from './store/sql/sqliteThread'
import { createStateStore } from './store/stateStore'
import {
	MAINTAIN_TASK_BUDGET_MS,
	MAINTAIN_TASK_SLUG,
	type MaintainTaskOutput,
	maintainTask,
} from './tasks/maintainTask'

export type { EventHostnameResolver, HostnameOption } from './ingest/resolveHostname'

/** How long the native engine keeps what it stores. */
export interface NativeRetention {
	/**
	 * Days of raw hits kept, today counted: how far back filtered and hourly reads reach. `null`
	 * keeps every hit. Default 90.
	 */
	rawDays?: number | null
	/**
	 * Days of daily totals kept, today counted; at least `rawDays`, which must then be set too.
	 * `null` keeps every day's. Default null.
	 */
	aggregateDays?: number | null
}

/** How the native engine reads the day still running. */
export interface NativeToday {
	/**
	 * Hits up to which today is read live; above it, from a background snapshot of its totals.
	 * Default 5,000 on Postgres, 2,000 on SQLite and MongoDB; 0 always reads a snapshot.
	 */
	snapshotAboveHits?: number
	/**
	 * Ms a snapshot is served before a background refresh. Default grows with the day's hits (one
	 * minute up to 50,000, five at 500,000) and with its counting cost. At least 1,000.
	 */
	maxAgeMs?: number
}

export interface NativeOptions {
	/**
	 * The source's name in pickers and listings: a string, a map by admin language (read like
	 * `view.navLabel`), or a function naming it per reader and scope. Default `'Payload'`.
	 */
	label?: AdapterLabelOption
	/**
	 * Where each event's country, region and city come from. One that throws costs the event its
	 * location, never the event, and is logged at most once an hour while it fails.
	 */
	geoResolver?: GeoResolver
	geoDbPath?: string
	/** Where the beacon endpoint listens, under `routes.api`. Default `<routes.base>/e`. */
	ingestPath?: string
	/**
	 * `true` batches hits in memory (200 hits or one second, at most 5,000 held); an object sets
	 * `maxSize`, `maxAgeMs` or `maxPending`. Unset writes each as it arrives. Orders are never held.
	 */
	buffer?: WriteBufferOption
	/**
	 * `'request'` (default) stores the request's host and ignores the body's claim; a list stores it
	 * only when listed; a resolver decides per event, and null drops it.
	 */
	hostname?: HostnameOption
	/**
	 * Platform domains that ingest under the null scope when the request resolves none. Tenant
	 * domains need no entry: `scope.resolve` already answers for them.
	 */
	platformHostnames?: string[]
	/**
	 * Drops crawlers, monitors and headless clients by user agent, on by default. A function receives
	 * the raw agent; `false` counts every beacon. `trackServerEvent` is never filtered.
	 */
	filterBots?: boolean | BotFilter
	/**
	 * `signature: 'required'` (default) keeps a page's item only when the server signed its ref
	 * (`signItemRef`, `itemAttributesFor`); `'optional'` also keeps unsigned refs.
	 */
	items?: { signature?: ItemSignatureMode }
	/**
	 * Values each kind of daily total keeps per scope, day and hostname, the rest folded into one
	 * `(other)` row; null keeps all. Kinds left out keep the defaults (`DEFAULT_CAPS`).
	 */
	caps?: CapsOption
	retention?: NativeRetention
	/** Today: read live while small, else from a snapshot (see `NativeToday`). */
	today?: NativeToday
	/** SQLite on a local file: where the engine's statements run (see `NativeSqlite`). */
	sqlite?: NativeSqlite
	/**
	 * The engine's collections, renamed with `slug` and reshaped with `overrides`. An override may
	 * change admin settings, access and `dbName`, but no field: the boot checks it.
	 */
	collections?: NativeCollections
	/**
	 * What this source's held slot does without consent, over `capture.withoutConsent`.
	 * `'cookieless'` is native's own capture, which stores nothing on the device; `'anonymous'` also
	 * keeps no visitor id, region, city or engagement for those hits; `'off'` sends nothing.
	 */
	withoutConsent?: NativeWithoutConsent
}

/** Native's levels without consent: the vendor ones, plus `anonymous`. */
export type NativeWithoutConsent = WithoutConsentLevel | 'anonymous'

const NATIVE_WITHOUT_CONSENT: readonly NativeWithoutConsent[] = ['cookieless', 'anonymous', 'off']

/** The engine's collections, by what they hold; each defaults to its `analytics-` slug. */
export interface NativeCollections {
	/** `analytics-hits`, one row per hit. */
	hits?: AnalyticsCollectionOptions
	/** `analytics-aggregates`, the daily totals. */
	aggregates?: AnalyticsCollectionOptions
	/** `analytics-state`: the daily salts, day markers, leases and heartbeats. */
	state?: AnalyticsCollectionOptions
}

/** Where the engine runs its statements on a local SQLite file. Remote libsql never blocks. */
export interface NativeSqlite {
	/**
	 * `'auto'` (default) uses worker threads in WAL mode with `busyTimeout` >= 5,000 ms, else the main
	 * thread, warning once. `ANALYTICS_SQLITE_THREAD` sets it where this does not.
	 */
	thread?: SqliteThread
}

/** The config native adapter's id, which a `native` provider document grants to a scope. */
export const NATIVE_ADAPTER_ID = 'native'

const D1_REFUSAL =
	'analytics: native() does not support Cloudflare D1 (@payloadcms/db-d1-sqlite) yet. The vendor adapters (Plausible, Umami, GA4, PostHog) work on D1: drop native() from adapters, or run the app on MongoDB, Postgres or SQLite.'

export interface NativeAdapter extends AnalyticsAdapter {
	/**
	 * Writes out what one instance holds back: its write buffer, and the server events that waited
	 * on a transaction which has since ended.
	 */
	flush(payload: Payload): Promise<void>
	/**
	 * Takes one beacon as the ingest endpoint does, for a request built outside Payload's own
	 * routing: what `ingestRoute` from `@10x-media/analytics/next` calls.
	 */
	receive(req: PayloadRequest): Promise<Response>
	/** Counts a stretch of one instance's days again, as `rebuildDays` asks. */
	rebuild(payload: Payload, input: RebuildDaysInput): Promise<RebuildDaysReport>
}

/** The native adapter among a runtime's adapters, recognized by its own seam. */
export const isNativeAdapter = (adapter: AnalyticsAdapter): adapter is NativeAdapter =>
	adapter.id === NATIVE_ADAPTER_ID &&
	typeof Reflect.get(adapter, 'receive') === 'function' &&
	typeof Reflect.get(adapter, 'flush') === 'function' &&
	typeof Reflect.get(adapter, 'rebuild') === 'function'

// The tracker itself is the client (`AnalyticsScripts` boots it), so there is nothing to
// proxy or inject; the ingest path is carried by the tracker config resolver instead.
const nativeCapture: CaptureSupport = {
	proxy: { routes: [] },
	snippet: () => ({ scripts: [] }),
	client: { kind: 'native' },
}

/** What every store filters with, which is what is declared before a store exists. */
const ANY_STORE_FILTERS = rawFilterMap(['eq', 'contains'])

/** Config-time check, so a mistyped mode fails the boot rather than every item at ingest. */
const itemSignatureMode = (value: unknown): ItemSignatureMode => {
	if (value === undefined || value === 'required') {
		return 'required'
	}
	if (value === 'optional') {
		return 'optional'
	}
	throw new Error(
		`analytics: native items.signature must be 'required' or 'optional', got ${String(value)}`
	)
}

/** A `retention` option as given, refused unless it is unset, null or a whole number of days. */
const retentionDays = (
	retention: NativeRetention | undefined,
	name: keyof NativeRetention
): number | null | undefined => {
	const value = retention?.[name]
	if (value !== undefined && value !== null && (!Number.isInteger(value) || value < 1)) {
		throw new Error(
			`analytics: native retention.${name} must be a whole number of days of at least 1, or null, got ${String(value)}`
		)
	}
	return value
}

/** Config-time check of `retention.rawDays`, so a window no read can start from fails the boot. */
const rawDaysOf = (retention: NativeRetention | undefined): number | null => {
	const value = retentionDays(retention, 'rawDays')
	return value === undefined ? DEFAULT_RAW_DAYS : value
}

/**
 * Config-time check of `retention.aggregateDays`: daily totals deleted while a day's raw hits are
 * still kept would be counted again on the next read, and deleted again after.
 */
const aggregateDaysOf = (
	retention: NativeRetention | undefined,
	rawDays: number | null
): number | null => {
	const value = retentionDays(retention, 'aggregateDays') ?? null
	if (value === null) {
		return null
	}
	if (rawDays === null || value < rawDays) {
		throw new Error(
			`analytics: native retention.aggregateDays (${value}) must be at least retention.rawDays (${rawDays ?? 'null, every hit kept'}): daily totals deleted while their raw hits are kept would be counted again`
		)
	}
	return value
}

/** Config-time check of `today`, so a value no read could use fails the boot. */
const todayOf = (today: NativeToday | undefined): NativeToday => {
	const check = (name: keyof NativeToday, value: number | undefined, min: number): void => {
		if (value !== undefined && (!Number.isInteger(value) || value < min)) {
			throw new Error(
				`analytics: native today.${name} must be a whole number of at least ${min.toLocaleString('en-US')}, got ${String(value)}`
			)
		}
	}
	check('snapshotAboveHits', today?.snapshotAboveHits, 0)
	check('maxAgeMs', today?.maxAgeMs, 1_000)
	return {
		...(today?.snapshotAboveHits === undefined
			? {}
			: { snapshotAboveHits: today.snapshotAboveHits }),
		...(today?.maxAgeMs === undefined ? {} : { maxAgeMs: today.maxAgeMs }),
	}
}

const STORE_KEYS = ['hits', 'aggregates', 'state'] as const satisfies ReadonlyArray<
	keyof StoreSlugs
>

type StoreCollections = Readonly<Record<keyof StoreSlugs, ResolvedCollectionOption>>

/** Config-time check of `collections`, so an unknown key, a bad slug or two alike fail the boot. */
const storeCollectionsOf = (value: unknown): StoreCollections => {
	const given = value ?? {}
	if (!isRecord(given) || Array.isArray(given)) {
		throw new Error(
			`analytics: native() collections must be an object such as { hits: { slug: 'site-hits' } }, got ${kindOf(value)}`
		)
	}
	for (const key of Object.keys(given)) {
		if (!STORE_KEYS.some((known) => known === key)) {
			throw new Error(
				`analytics: native() collections.${key} is not a collection of the engine; it has ${STORE_KEYS.join(', ')}`
			)
		}
	}
	const of = (key: keyof StoreSlugs): ResolvedCollectionOption =>
		resolveCollectionOption(given[key], {
			path: `native() collections.${key}`,
			fallback: DEFAULT_STORE_SLUGS[key],
		})
	const collections = { hits: of('hits'), aggregates: of('aggregates'), state: of('state') }
	const slugs = STORE_KEYS.map((key) => collections[key].slug)
	if (new Set(slugs).size !== slugs.length) {
		throw new Error(
			`analytics: native() collections name one slug twice (${slugs.join(', ')}); each of the engine's collections needs its own`
		)
	}
	return collections
}

/** Config-time check of `sqlite.thread`, so a mistyped mode fails the boot. */
const sqliteThreadOf = (sqlite: NativeSqlite | undefined): SqliteThread | undefined => {
	const value = sqlite?.thread
	if (value === undefined || isSqliteThread(value)) {
		return value
	}
	throw new Error(
		`analytics: native sqlite.thread must be one of ${SQLITE_THREADS.map((each) => `'${each}'`).join(', ')}, got ${kindOf(value)}`
	)
}

/** What one `register()` call handed the adapter, which every instance built after it uses. */
interface Registration {
	scoped: boolean
	maxmind?: MaxmindSdk
	resolvers: IngestResolvers
	attribution: IngestAttribution
	/** The collections bound as items and whether they are counted per page, when any are bound. */
	items?: { collections: ReadonlySet<string>; pages: boolean }
	revenue?: AdapterRegisterContext['revenue']
	/** The maintenance task's queue and schedule, or false when the install registers none. */
	jobs: AdapterJobs
	/** Whether the task may carry a concurrency key: the host's `jobs.enableConcurrencyControl`. */
	jobsConcurrency: boolean
}

export function native(options: NativeOptions = {}): NativeAdapter {
	assertNoLegacyOptions(options, { legacy: LEGACY_NATIVE_OPTIONS, owner: 'native() option ' })
	// Validated here so a bad value fails the boot rather than the first beacon or read.
	const hostname = resolveHostnameOption(options.hostname)
	const filterBots = resolveBotFilter(options.filterBots)
	const signatureMode = itemSignatureMode(options.items?.signature)
	const caps = resolveCaps(options.caps)
	resolveWriteBuffer(options.buffer)
	const rawDays = rawDaysOf(options.retention)
	const aggregateDays = aggregateDaysOf(options.retention, rawDays)
	const today = todayOf(options.today)
	const sqliteThread = sqliteThreadOf(options.sqlite)
	const platformHostnames = hostnameSet(options.platformHostnames, 'platformHostnames')
	const collections = storeCollectionsOf(options.collections)
	const withoutConsent = adapterWithoutConsent(
		options.withoutConsent,
		'native({ withoutConsent })',
		NATIVE_WITHOUT_CONSENT
	)
	const slugs: StoreSlugs = {
		hits: collections.hits.slug,
		aggregates: collections.aggregates.slug,
		state: collections.state.slug,
	}
	const configuredGeo =
		options.geoResolver ??
		(options.geoDbPath
			? composeGeoResolvers(platformHeaderResolver, maxmindResolver({ dbPath: options.geoDbPath }))
			: platformHeaderResolver)
	let warnedMaxmind = false
	let mountedIngestPath = routePaths(DEFAULT_ROUTE_BASE).ingest

	const registrationOf = (context: AdapterRegisterContext | undefined): Registration => {
		const scoped = context?.scoped ?? false
		const grantedForScope = context?.adapterGrantedForScope
		return {
			scoped,
			...(context?.sdks?.maxmind ? { maxmind: context.sdks.maxmind } : {}),
			resolvers: {
				...(scoped && context ? { scope: context.resolveScope } : {}),
				...(context ? { timezone: context.resolveTimezoneStrict } : {}),
				...(context ? { currency: context.revenue.currency } : {}),
				...(context?.revenue.convert ? { convertCurrency: context.revenue.convert } : {}),
				...(context ? { goals: context.resolveGoals } : {}),
				...(scoped && grantedForScope
					? {
							granted: (req: PayloadRequest, scope: string | null) =>
								grantedForScope(req, scope, NATIVE_ADAPTER_ID),
						}
					: {}),
			},
			attribution: {
				trustedProxyHops: context?.trustedProxyHops,
				trustedPlatform: context?.trustedPlatform,
				...(context?.allowedOrigins ? { allowedOrigins: context.allowedOrigins } : {}),
				hostname,
				platformHostnames,
			},
			...(context?.items && context.items.collections.size > 0 ? { items: context.items } : {}),
			...(context?.revenue ? { revenue: context.revenue } : {}),
			jobs: context?.jobs ?? DEFAULT_JOBS,
			jobsConcurrency: context?.jobsConcurrency === true,
		}
	}

	/** What the adapter declares for a registration, with the filters its store applies. */
	const capabilitiesOf = (
		registration: Registration,
		filters: AnalyticsCapabilities['filters']
	): AnalyticsCapabilities =>
		nativeCapabilities({
			filters: filters ?? ANY_STORE_FILTERS,
			rawDays,
			scoped: registration.scoped,
			...(registration.revenue ? { revenue: registration.revenue } : {}),
			items: registration.items !== undefined,
		})

	/** Each collection checked after the host's overrides; boot warnings go to `notice`. */
	const addStoreCollections = (
		config: Config,
		notice: ((message: string) => void) | undefined
	): void => {
		const built = {
			hits: hitsCollection(slugs.hits),
			aggregates: aggregatesCollection(slugs.aggregates),
			state: stateCollection(slugs.state),
		}
		const shaped = STORE_KEYS.map((key) => {
			const { overrides } = collections[key]
			return shapeCollection(built[key], {
				role: key,
				option: `native() collections.${key}`,
				db: config.db?.name,
				...(overrides ? { overrides } : {}),
			})
		})
		for (const message of shaped.flatMap((each) => each.notices)) {
			notice?.(message)
		}
		config.collections = [...(config.collections ?? []), ...shaped.map((each) => each.collection)]
	}

	let registration = registrationOf(undefined)
	let capabilities = capabilitiesOf(registration, ANY_STORE_FILTERS)

	const geoResolver: GeoResolver = (headers, opts) => {
		const maxmind = registration.maxmind
		return configuredGeo(headers, maxmind ? { ...opts, maxmind } : opts)
	}

	const build = (payload: Payload, built: Registration): NativeInstance => {
		if (isD1(payload)) {
			throw new Error(D1_REFUSAL)
		}
		const executor =
			dbKind(payload) === 'mongo'
				? undefined
				: createSqlExecutor(payload, sqliteThread === undefined ? {} : { thread: sqliteThread })
		// Every browser record is the server's own when signatures are required: none is forged, so
		// the two records of an order are one sale however far apart they lie.
		const ordersSigned = built.revenue?.orderSignature === 'required'
		const twinWindowMs = ordersSigned ? null : TWIN_WINDOW_MS
		const store = createEventStore(payload, {
			slugs,
			twinWindowMs,
			...(executor ? { executor } : {}),
		})
		const state = createStateStore(payload, {
			slug: slugs.state,
			...(executor ? { executor } : {}),
		})
		const declared = capabilitiesOf(built, store.features.filters)
		capabilities = declared
		// A request of its own per call: one kept would hold its dataloader's documents and its
		// context for the life of the process.
		const localRequest = (): Promise<PayloadRequest> => createLocalReq({}, payload)
		const zoneOf = built.resolvers.timezone
		const currencyOf = built.resolvers.currency
		const engine = createEngine({
			payload,
			store,
			state,
			options: {
				scoped: built.scoped,
				...(zoneOf
					? {
							timezone: async (scope: string, req?: PayloadRequest) =>
								zoneOf(req ?? (await localRequest()), scope === '' ? null : scope),
						}
					: {}),
				...(currencyOf
					? {
							currency: async (scope: string) =>
								currencyOf(await localRequest(), scope === '' ? null : scope),
						}
					: {}),
				dimensions: declared.dimensions,
				...(declared.filters ? { filters: declared.filters } : {}),
				caps,
				itemPages: built.items?.pages ?? true,
				rawDays,
				aggregateDays,
				today,
				maintenance:
					built.jobs === false
						? { runner: false }
						: { runner: true, intervalMs: built.jobs.maintain.intervalMs },
				twinWindowMs,
			},
		})
		const secret: unknown = payload.secret
		const keyed = typeof secret === 'string' && secret !== ''
		const items: ItemIngestOptions | undefined = built.items
			? {
					collections: built.items.collections,
					idTypes: itemIdTypes(payload, built.items.collections),
					// Without a secret no signature a page sends can be checked: only server items are kept.
					...(keyed ? { signature: { mode: signatureMode, key: itemRefKey(secret) } } : {}),
				}
			: undefined
		const warn = (message: string) => payload.logger.warn(message)
		const keepAlive = createKeepAlive({
			// biome-ignore lint/plugin/noProcessEnv: Next's marker for processes where `after()` works
			env: process.env,
			warn,
		})
		return {
			registration: built,
			store,
			state,
			engine,
			// Without a secret no order signature can be checked: with signatures required, none passes.
			orders: {
				mode: built.revenue?.orderSignature ?? DEFAULT_ORDER_SIGNATURE,
				...(keyed ? { key: orderRefKey(secret) } : {}),
			},
			keepAlive: (work: Promise<unknown>) => {
				keepAlive(work).catch(() => undefined)
			},
			salts: createDailySalts({ state, warn, recorded: (scope) => state.lastZone(scope) }),
			writer: createHitWriter({
				store,
				...(options.buffer === undefined ? {} : { buffer: options.buffer }),
				logger: payload.logger,
			}),
			items,
			sqlite: dbKind(payload) === 'sqlite',
			nudge: () => engine.nudge(),
			siteHosts: createSiteHosts({ store, now: currentDate, warn }),
			...(executor ? { release: () => executor.close() } : {}),
		}
	}

	/** The instance's engine, built on first use and again after the adapter is registered anew. */
	const instanceOf = (payload: Payload): NativeInstance => {
		if (isDestroyed(payload)) {
			throw new Error(
				'analytics: this Payload instance was destroyed, so its native engine is closed'
			)
		}
		const current = registration
		return nativeInstanceFor(payload, current, () => build(payload, current))
	}

	const payloadOf = (ctx: AdapterContext | undefined): Payload => {
		if (!ctx?.payload) {
			throw new Error(
				'analytics: the native adapter reads through the Payload instance in its context, and none was given'
			)
		}
		return ctx.payload
	}

	const beaconHandler = (): PayloadHandler =>
		makeIngestHandler({
			geoResolver,
			target: instanceOf,
			resolvers: registration.resolvers,
			attribution: registration.attribution,
			filterBots,
			...(registration.revenue?.browserAmounts
				? { browserAmounts: registration.revenue.browserAmounts }
				: {}),
		})

	// One handler per registration, so its once-a-process warnings are said once, not per beacon.
	let receiveBeacon = beaconHandler()
	const receive = async (req: PayloadRequest): Promise<Response> => {
		// A beacon can be the first thing an instance serves (a worker booted without onInit, a
		// fresh HMR config): the runtime attaches the adapter to it first.
		getRuntime(req.payload)
		return receiveBeacon(req)
	}

	/**
	 * One run of `analytics-maintain`, on whichever instance the job runner took it on: the engine's
	 * upkeep, then the read cache's expired entries, under the sweep's own lease.
	 */
	const maintainOnTask = async (
		req: PayloadRequest,
		input: { rebuild?: RebuildDaysInput }
	): Promise<MaintainTaskOutput> => {
		// A worker booted without onInit may run the task before anything else built its runtime.
		const runtime = getRuntime(req.payload)
		const report = await instanceOf(req.payload).engine.maintain({
			budgetMs: MAINTAIN_TASK_BUDGET_MS,
			req,
			heartbeat: true,
			...(input.rebuild ? { rebuild: input.rebuild } : {}),
		})
		let sweptCache = 0
		try {
			sweptCache = (await runtime?.cache?.sweeper.sweep(TASK_SWEEP_BATCHES))?.swept ?? 0
		} catch (err) {
			req.payload.logger.warn(`analytics: sweeping expired cache entries failed: ${String(err)}`)
		}
		return { ...report, sweptCache }
	}

	const ingest = {
		// Read late: the plugin's base arrives with the register context.
		get path() {
			return options.ingestPath ?? mountedIngestPath
		},
		track: makeServerTrack({
			geoResolver,
			target: instanceOf,
			getResolvers: () => registration.resolvers,
			getAttribution: () => registration.attribution,
		}),
		// The endpoint's hostname policy without the scoped drop rule (this caller knows its
		// boundary); a capture call site, so the host's resolver sees the visit, not the user.
		hostname: (args: Parameters<IngestHostnameResolver>[0]) =>
			resolveEventHostname({
				option: hostname,
				claimed: args.claimed,
				req: captureRequest(args.req),
				scope: args.scope ?? null,
				trustedProxyHops: registration.attribution.trustedProxyHops,
			}),
	}

	return {
		id: NATIVE_ADAPTER_ID,
		...adapterLabel(options.label, 'Payload', 'native({ label })'),
		get capabilities() {
			return capabilities
		},
		capture: { ...nativeCapture, ...cookielessCapture({ kind: 'inherent' }, withoutConsent) },
		ingest,
		isConfigured: () => true,
		flush: async (payload) => {
			await instanceOf(payload).writer.flush()
		},
		rebuild: (payload, input) => {
			getRuntime(payload)
			return instanceOf(payload).engine.rebuild(input)
		},
		receive,
		register(config: Config, context) {
			if (isD1({ db: { name: config.db?.name ?? '' } })) {
				throw new Error(D1_REFUSAL)
			}
			registration = registrationOf(context)
			capabilities = capabilitiesOf(registration, ANY_STORE_FILTERS)
			if (context?.routes) {
				mountedIngestPath = context.routes.ingest
			}
			receiveBeacon = beaconHandler()
			addStoreCollections(config, context?.notice)
			config.endpoints = [
				...(config.endpoints ?? []),
				{ method: 'post', path: ingest.path, handler: receive },
			]
			const { jobs } = registration
			if (jobs !== false) {
				addTask(
					config,
					maintainTask({
						schedule: jobs.maintain,
						run: maintainOnTask,
						concurrency: registration.jobsConcurrency,
					})
				)
			}
		},
		registerSchema(config: Config, context: AdapterSchemaContext) {
			addStoreCollections(config, context.notice)
			if (context.jobs !== false) {
				addTask(config, schemaOnlyTask(MAINTAIN_TASK_SLUG, context.jobs.maintain))
			}
		},
		attach(payload: Payload) {
			if (isD1(payload)) {
				throw new Error(D1_REFUSAL)
			}
			if (
				!warnedMaxmind &&
				registration.maxmind === undefined &&
				needsMaxmindSdk(configuredGeo) &&
				isProductionBuild()
			) {
				warnedMaxmind = true
				payload.logger?.warn(MAXMIND_SDK_WARNING)
			}
			instanceOf(payload)
		},
		async close(payload: Payload) {
			await closeNativeInstance(payload, registration)
		},
		async query(q: AnalyticsQuery, ctx?: AdapterContext): Promise<AnalyticsResult> {
			return instanceOf(payloadOf(ctx)).engine.read(q, ctx)
		},
		async realtime(q: AnalyticsQuery, ctx?: AdapterContext): Promise<AnalyticsResult> {
			return instanceOf(payloadOf(ctx)).engine.realtime(q, ctx)
		},
	}
}
