import type { Payload } from 'payload'
import { OVER_BUDGET, withinBudget } from '../core/budget'
import { buildCacheKey, type CacheKeyEpochs } from '../core/cacheKey'
import { unsupportedFilter } from '../core/capabilities'
import { currentTime } from '../core/clock'
import type {
	AdapterContext,
	AnalyticsAdapter,
	AnalyticsQuery,
	AnalyticsResult,
	SourceErrorKind,
} from '../core/contract'
import { monotonicMs } from '../core/monotonic'
import { UnsupportedFilterError } from '../core/sourceErrors'
import { earlierInstant, isRecord } from '../core/values'
import type { TimeframePreset } from '../timeframe/presets'
import { DAY_MS, DEFAULT_TIMEZONE, startOfDayInTz } from '../timeframe/tz'
import type { AfterReadAnswer, AfterReadHook, ReadOrigin } from './afterRead'
import {
	type CacheEntry,
	type CacheStore,
	isCachedResult,
	type ReadRecipe,
	STALE_WINDOW_SECONDS,
} from './cacheStore'
import {
	classifyError,
	isLaneRefused,
	PROVIDER_READ_TIMEOUT_MESSAGE,
	ReadFailedError,
	type ReadFailure,
	ScopeBusyError,
} from './classifyError'
import { createCoalescer } from './coalesce'
import { BUSY_RETRY_AFTER_MS, createColdBudget, DEFAULT_COLD_READS_PER_SCOPE } from './coldBudget'
import { type EpochSources, epochsFor } from './epoch'
import { createLanes, type LaneHealth, type Lanes, type Priority, runUpstream } from './lanes'
import { AGGREGATE_MEMO_MS, createMemo, type Memo } from './memo'
import { dayRead, foldResult, type RebucketPlan, rebucketPlan } from './rebucket'
import { RECIPE_WINDOWS, recipeWindow } from './recipe'
import { shapeResult } from './shape'
import { mergeAtToday, splitAtToday } from './todaySplit'

/** How often a read carrying a recipe stamps the entry it was served as read. */
const TOUCH_EVERY_MS = 3_600_000

/** How long a key's last failed refresh is remembered, to word or refuse its stale answers. */
const FAILURE_MEMO_MS = 60_000

/** How long a peek waits on the store before it answers that nothing is there. */
export const PEEK_BUDGET_MS = 150

/** How long a read waits on the store before reading the source as if nothing were cached. */
const STORE_GET_BUDGET_MS = 1_000

/** An instant a store handed back: finite epoch milliseconds. */
const isInstant = (value: unknown): value is number =>
	typeof value === 'number' && Number.isFinite(value)

/** Whether an entry's instants are what the store contract says: finite epoch milliseconds. */
const hasInstants = (entry: CacheEntry): boolean =>
	isInstant(entry.fetchedAt) &&
	isInstant(entry.expiresAt) &&
	isInstant(entry.staleUntil) &&
	(entry.readAt === undefined || entry.readAt === null || isInstant(entry.readAt))

/**
 * The clock deadlines, waits and durations run on: the one timers run on. The cache clock (`now`)
 * may be moved by a test, or by Payload's job-system globals, without any timer moving with it.
 */
const timerNow = monotonicMs

/**
 * The window a source is asked for, from its lookback on; one that declares none still starts no
 * earlier than 1970, before which nothing was counted, so no read walks centuries of days.
 */
const clampRange = (
	range: AnalyticsQuery['dateRange'],
	maxLookbackDays: number | null,
	tz: string = DEFAULT_TIMEZONE
): { range: AnalyticsQuery['dateRange']; clamped: boolean } => {
	const floor =
		maxLookbackDays == null ? 0 : startOfDayInTz(range.end, tz).getTime() - maxLookbackDays * DAY_MS
	if (range.start.getTime() >= floor) {
		return { range, clamped: false }
	}
	return { range: { start: new Date(floor), end: range.end }, clamped: true }
}

/**
 * A breakdown cut by `limit` with no `order` asks its source for its first metric's top rows: a
 * source ranking by anything else would hand over a subset the engine cannot rank back.
 */
const rankedQuery = (query: AnalyticsQuery): AnalyticsQuery => {
	const metric = query.metrics[0]
	return query.limit !== undefined &&
		query.order === undefined &&
		(query.dimensions?.length ?? 0) > 0 &&
		metric !== undefined
		? { ...query, order: { metric, direction: 'desc' } }
		: query
}

export type CacheOperation = 'get' | 'set' | 'touch'

export interface EngineOptions {
	store: CacheStore
	/** The instance's in-process memo; a private one of the default size when absent. */
	memo?: Memo<AnalyticsResult>
	/** Lanes reads reach their sources through; a private set with default caps when absent. */
	lanes?: Lanes
	/** Cold reads one scope may have waiting on its sources at once; default 8. */
	coldReadsPerScope?: number
	/** Explicit TTL overrides; when a value is unset the adapter's recommendedTtl applies. */
	ttl: { aggregate?: number; realtime?: number }
	/**
	 * Budget for one fetch from a source, every wait and retry included; the request in flight is
	 * aborted past it.
	 */
	timeoutMs: number
	/** Called once per failed fetch, before falling back to a stale cache entry. */
	onError?: (err: unknown, adapterId: string) => void
	/** Called when the store fails; the read carries on as if the entry were absent or unwritten. */
	onStoreError?: (err: unknown, operation: CacheOperation) => void
	/** Called after each value the store accepted. */
	onWrite?: () => void
	/**
	 * The scope's refresh epoch, which every key carries. Absent, every read keys on the initial
	 * token.
	 */
	epoch?: EpochSources['refresh']
	/** The scope's configuration epoch, which every key carries; absent, a fixed one. */
	configEpoch?: EpochSources['config']
	/** The instance every read is for, handed to adapters as `AdapterContext.payload`. */
	payload?: Payload
	/** Epoch milliseconds; the plugin's clock (`currentDate`) by default. */
	now?: () => number
	/**
	 * Keeps a background refresh running past the response that started it: Next's `after()` inside
	 * a request. The engine tracks every refresh itself as well, so `idle()` waits for all of them.
	 */
	keepAlive?: (work: Promise<unknown>) => void | Promise<void>
	/** `hooks.afterRead`, run only on an engine built with `payload`, which the hook is handed. */
	afterRead?: AfterReadHook
	/** Told each time the hook throws; the read is answered as if it had returned nothing. */
	onHookError?: (err: unknown) => void
	/** Called as each read starts, before anything is looked up. */
	onRead?: () => void
}

export interface ReadOptions {
	/**
	 * False waits for an expired entry's refresh instead of answering with it, falling back to it
	 * only when the refresh fails; for work that keeps what it reads (sync). Default true.
	 */
	allowStale?: boolean
	/**
	 * The named timeframe the read's window came from; when the window is that preset's as of now,
	 * the read's recipe is stored with its entry so the warm task keeps it warm.
	 */
	timeframe?: TimeframePreset
	/**
	 * `interactive` for an open panel or view, served first; `background` for work nobody waits on,
	 * held to half a source's slots like every refresh. Default `normal`.
	 */
	priority?: Priority
	/**
	 * On a full scope (`coldReadsPerScope`) a cold read waits within `timeoutMs` (default), or with
	 * `refuse` fails at once as `rate_limited`; a read matching one already waiting joins it anyway.
	 */
	whenBusy?: 'wait' | 'refuse'
	/**
	 * False answers without `hooks.afterRead`: work that keeps what it reads (sync) stores the
	 * source's own answer, never what the hook made of it for one reader. Default true.
	 */
	afterRead?: boolean
}

export interface RefreshOptions {
	/** An entry still fresh for this many more milliseconds is left as it is. */
	freshForMs: number
	/** Default `background`. */
	priority?: Priority
}

/** What a refresh did: left an entry fresh enough, or read the source again and stored it. */
export type RefreshOutcome = 'fresh' | 'refreshed'

export interface PeekOptions {
	/** Milliseconds the memo and the store may take to answer; default {@link PEEK_BUDGET_MS}. */
	budgetMs?: number
}

export interface Engine {
	read(
		adapter: AnalyticsAdapter,
		query: AnalyticsQuery,
		options?: ReadOptions
	): Promise<AnalyticsResult>
	/**
	 * The warm task's read: re-reads `query` and stores the answer unless its entry stays fresh for
	 * `freshForMs` more, never touching its recipe or read time. Absent when nothing caches.
	 */
	refresh?(
		adapter: AnalyticsAdapter,
		query: AnalyticsQuery,
		options: RefreshOptions
	): Promise<RefreshOutcome>
	/**
	 * What a read would answer from memory or the store, never asking the source or refreshing;
	 * undefined when neither holds it within the budget. Absent on an engine that caches nothing.
	 */
	peek?(
		adapter: AnalyticsAdapter,
		query: AnalyticsQuery,
		options?: PeekOptions
	): Promise<AnalyticsResult | undefined>
	/**
	 * A live count from the adapter's `realtime`, through its lane at interactive priority and
	 * within the read timeout; never cached here. Absent on an engine without lanes.
	 */
	realtime?(adapter: AnalyticsAdapter, query: AnalyticsQuery): Promise<AnalyticsResult>
	/** Settles once every background refresh has finished; absent on one starting none. */
	idle?(): Promise<void>
	/**
	 * Keeps `work` a caller stopped waiting for running past the response, counted until it settles
	 * so `idle()` and `close()` wait for it. Absent on an engine starting no background work.
	 */
	keep?(work: Promise<unknown>): void
	/**
	 * Starts no background work from now on (refreshes, cache writes) and settles what is running:
	 * the runtime holding the engine is retired. Reads still answer.
	 */
	close?(): Promise<void>
	/**
	 * The state of the lane an adapter's reads go through for `scope`; absent on an engine without
	 * lanes.
	 */
	health?(adapter: AnalyticsAdapter, scope?: string | null): LaneHealth
}

/**
 * An adapter drops a filter it cannot apply and answers unfiltered, which would read as filtered
 * numbers: every caller gates first, and this is the gate behind them all.
 */
const checkFilters = (adapter: AnalyticsAdapter, query: AnalyticsQuery): void => {
	const refused = unsupportedFilter(adapter.capabilities, query.filters ?? [])
	if (refused) {
		throw new UnsupportedFilterError(adapter.id, refused)
	}
}

/** A hook's answer that replaces the read's, rather than nothing. */
const replaces = (answer: AfterReadAnswer): answer is AnalyticsResult => isRecord(answer)

const emptyResult = (provider: string, at: number): AnalyticsResult => ({
	rows: [],
	meta: { provider, fetchedAt: new Date(at).toISOString() },
})

/** `result` with `meta.fetchedAt` no later than `answeredAt`, replacing a later or bad one. */
const readAt = (result: AnalyticsResult, answeredAt: number): AnalyticsResult => {
	const stamped = Date.parse(result.meta.fetchedAt)
	return Number.isFinite(stamped) && stamped <= answeredAt
		? result
		: { ...result, meta: { ...result.meta, fetchedAt: new Date(answeredAt).toISOString() } }
}

/** An expired entry as served: stale, dated to its fetch, and why its source needs a look. */
const staleResult = (entry: CacheEntry, sourceError?: SourceErrorKind): AnalyticsResult => ({
	...entry.value,
	meta: {
		...entry.value.meta,
		stale: true,
		asOf: earlierInstant(entry.value.meta.asOf, new Date(entry.fetchedAt).toISOString()),
		...(sourceError ? { sourceError } : {}),
	},
})

/**
 * Why a stale answer's source needs a look: the key's own last failure when there is one, else the
 * failure its lane last counted, but only a failure about setup, never an outage.
 */
const sourceErrorOf = (
	failure: ReadFailure | undefined,
	health: LaneHealth
): SourceErrorKind | undefined => {
	if (failure) {
		if (failure.kind !== 'source_misconfigured') {
			return undefined
		}
		return failure.hostRefused ? 'host-refused' : 'misconfigured'
	}
	if (health.lastFailure !== 'source_misconfigured') {
		return undefined
	}
	return health.hostRefused ? 'host-refused' : 'misconfigured'
}

/** A failure as it is thrown: an outage says how long to wait when its lane knows. */
const withLaneRetryAfter = (failure: ReadFailure, health: LaneHealth): ReadFailure =>
	failure.kind === 'unavailable' &&
	failure.retryAfterMs === undefined &&
	health.retryAfterMs !== undefined
		? { ...failure, retryAfterMs: health.retryAfterMs }
		: failure

/** What a peek found kept for a query, and where. */
interface Kept {
	q: AnalyticsQuery
	result: AnalyticsResult
	from: ReadOrigin
}

/** One read made ready: its query as keyed, the request its source gets, and its cache key. */
interface Prepared {
	/** The query as asked, its window clamped to the source's lookback. */
	q: AnalyticsQuery
	clamped: boolean
	range: AnalyticsQuery['dateRange']
	plan: RebucketPlan | undefined
	/** What the adapter is asked: the query, or its days where weeks or months are folded here. */
	adapterQuery: AnalyticsQuery
	epochs: CacheKeyEpochs
	key: string
}

export function createEngine(opts: EngineOptions): Required<Engine> {
	const now = opts.now ?? currentTime
	const memo = opts.memo ?? createMemo<AnalyticsResult>({ now })
	const failures = createMemo<ReadFailure>({ now })
	const coalesce = createCoalescer<AnalyticsResult>()
	const lanes = opts.lanes ?? createLanes()
	const budget = createColdBudget(opts.coldReadsPerScope ?? DEFAULT_COLD_READS_PER_SCOPE)
	const background = new Set<Promise<unknown>>()
	const storeGetMs = Math.min(STORE_GET_BUDGET_MS, opts.timeoutMs)
	let closed = false

	/**
	 * The store's entry for `key`, or null: a store that fails, answers past
	 * {@link STORE_GET_BUDGET_MS} or breaks the entry contract is reported and read as a miss.
	 */
	const cached = async (key: string): Promise<CacheEntry | null> => {
		let entry: CacheEntry | null | typeof OVER_BUDGET
		try {
			entry = await withinBudget(opts.store.get(key), storeGetMs)
		} catch (err) {
			opts.onStoreError?.(err, 'get')
			return null
		}
		if (entry === OVER_BUDGET) {
			opts.onStoreError?.(
				new Error(`analytics: the read cache did not answer within ${storeGetMs} ms`),
				'get'
			)
			return null
		}
		if (!entry || !isCachedResult(entry.value)) {
			return null
		}
		if (!hasInstants(entry)) {
			opts.onStoreError?.(
				new Error(
					'analytics: the read cache answered an entry whose fetchedAt, expiresAt or staleUntil is not a finite number of milliseconds'
				),
				'get'
			)
			return null
		}
		return entry
	}

	/** Tracks `work` until it settles, keeping it alive past the response; answers once settled. */
	const inBackground = (work: Promise<unknown>): Promise<void> => {
		const settled = work.then(
			() => undefined,
			() => undefined
		)
		background.add(settled)
		void settled.finally(() => background.delete(settled))
		try {
			const kept = opts.keepAlive?.(settled)
			if (kept instanceof Promise) {
				kept.catch(() => {})
			}
		} catch {
			// Outside a request there is nothing to keep alive; the engine's own tracking still holds it.
		}
		return settled
	}

	const idle = async (): Promise<void> => {
		while (background.size > 0) {
			await Promise.all([...background])
		}
	}

	/** Writes an answer to the store, never failing the read: a store that fails is reported. */
	const store = async (
		key: string,
		result: AnalyticsResult,
		options: Parameters<CacheStore['set']>[2]
	): Promise<void> => {
		try {
			await opts.store.set(key, result, options)
			opts.onWrite?.()
		} catch (err) {
			opts.onStoreError?.(err, 'set')
		}
	}

	/**
	 * One call to the source through the adapter's lane: per request when the adapter sends through
	 * `upstream`, else one token and slot for the whole call.
	 */
	const throughLane = (
		adapter: AnalyticsAdapter,
		call: (ctx: AdapterContext) => Promise<AnalyticsResult>,
		run: { signal: AbortSignal; priority: Priority; deadline: number; scope: string | null }
	): Promise<AnalyticsResult> => {
		const lane = lanes.for(adapter, run.scope)
		const options = { ...run, now: timerNow }
		const base: AdapterContext = {
			...(opts.payload ? { payload: opts.payload } : {}),
			signal: run.signal,
			now: () => new Date(now()),
			remainingMs: () => Math.max(0, run.deadline - timerNow()),
		}
		if (adapter.capabilities.upstreamAware) {
			return call({
				...base,
				upstream: <T>(fn: (signal?: AbortSignal) => Promise<T>) => runUpstream(lane, fn, options),
			})
		}
		return runUpstream(
			lane,
			(signal) =>
				call({
					...base,
					signal,
					upstream: <T>(fn: (signal?: AbortSignal) => Promise<T>) => fn(signal),
				}),
			options
		)
	}

	/** Runs `hooks.afterRead` on one answer; a hook that throws answers as if it returned nothing. */
	const answered = async (args: {
		adapter: AnalyticsAdapter
		q: AnalyticsQuery
		result: AnalyticsResult
		from: ReadOrigin
		startedAt: number
	}): Promise<AnalyticsResult> => {
		const { afterRead: hook, payload } = opts
		if (!hook || !payload) {
			return args.result
		}
		try {
			const adjusted = await hook({
				adapterId: args.adapter.id,
				query: args.q,
				result: args.result,
				from: args.from,
				durationMs: Math.max(0, timerNow() - args.startedAt),
				payload,
			})
			return replaces(adjusted) ? adjusted : args.result
		} catch (err) {
			opts.onHookError?.(err)
			return args.result
		}
	}

	/**
	 * Settles with `work` or rejects after `timeoutMs`, aborting the signal; the race also bounds an
	 * adapter that never checks it. Lane slots return once the request settles or is abandoned.
	 */
	const withinTimeout = async <T>(
		work: (run: { signal: AbortSignal; deadline: number }) => Promise<T>
	): Promise<T> => {
		const controller = new AbortController()
		const deadline = timerNow() + opts.timeoutMs
		const timer = setTimeout(
			() => controller.abort(new Error(PROVIDER_READ_TIMEOUT_MESSAGE)),
			opts.timeoutMs
		)
		timer.unref?.()
		try {
			const aborted = new Promise<never>((_resolve, reject) => {
				controller.signal.addEventListener('abort', () => reject(controller.signal.reason), {
					once: true,
				})
			})
			const attempt = work({ signal: controller.signal, deadline })
			attempt.catch(() => {})
			aborted.catch(() => {})
			return await Promise.race([attempt, aborted])
		} finally {
			clearTimeout(timer)
		}
	}

	const prepare = async (
		adapter: AnalyticsAdapter,
		query: AnalyticsQuery,
		known?: CacheKeyEpochs
	): Promise<Prepared> => {
		const { range, clamped } = clampRange(
			query.dateRange,
			adapter.capabilities.maxLookbackDays,
			query.timezone
		)
		const ranked = rankedQuery(query)
		const q = range === query.dateRange ? ranked : { ...ranked, dateRange: range }
		// Weeks and months are folded here from days, exactly the same way for every source
		// that cannot answer them itself; the cache keys on the bucket the caller asked for.
		const plan = rebucketPlan(q, adapter.capabilities)
		const adapterQuery = plan ? dayRead(q, plan) : q
		// Resolved before the key so the coalescer key carries the epochs too: two reads
		// across a bump must not share one in-flight answer.
		const epochs =
			known ?? (await epochsFor({ refresh: opts.epoch, config: opts.configEpoch }, q.scope))
		return {
			q,
			clamped,
			range,
			plan,
			adapterQuery,
			epochs,
			key: buildCacheKey(adapter.id, q, epochs),
		}
	}

	/** The instant today began in the read's zone. */
	const todayStart = (q: AnalyticsQuery): number =>
		startOfDayInTz(new Date(now()), q.timezone ?? DEFAULT_TIMEZONE).getTime()

	/**
	 * How long the source's answer for `q` stays fresh, when the source bounds a window reaching into
	 * the current day (native's `recommendedTtl.today`); undefined for every other read.
	 */
	const todayTtl = (adapter: AnalyticsAdapter, q: AnalyticsQuery): number | undefined => {
		const bound = adapter.capabilities.recommendedTtl.today
		if (bound === undefined) {
			return undefined
		}
		return q.dateRange.end.getTime() >= todayStart(q) ? bound : undefined
	}

	/** Holds a fresh store entry in memory until it expires, at most {@link AGGREGATE_MEMO_MS}. */
	const memoizeEntry = (key: string, entry: CacheEntry, at: number): void => {
		memo.set(key, entry.value, Math.min(AGGREGATE_MEMO_MS, entry.expiresAt - at))
	}

	/**
	 * The read's recipe when its window is its timeframe's as of now, matched on the key a recipe
	 * replayed now would read: the window as the key cuts it, after the same clamp.
	 */
	const recipeOf = async (
		adapter: AnalyticsAdapter,
		prepared: Prepared,
		timeframe: TimeframePreset | undefined
	): Promise<ReadRecipe | undefined> => {
		if (timeframe === undefined) {
			return undefined
		}
		const at = new Date(now())
		const { q } = prepared
		const tz = q.timezone ?? DEFAULT_TIMEZONE
		const { dateRange: _window, ...rest } = q
		// MongoDB stores an absent field as null, which a replay would then key on.
		for (const key of Object.keys(rest)) {
			if (Reflect.get(rest, key) === undefined) {
				Reflect.deleteProperty(rest, key)
			}
		}
		for (const window of RECIPE_WINDOWS) {
			const candidate = recipeWindow({ timeframe, window }, at, tz)
			if (!candidate) {
				continue
			}
			const replayed = await prepare(adapter, { ...q, dateRange: candidate }, prepared.epochs)
			if (replayed.key === prepared.key) {
				return { adapterRef: adapter.id, scope: q.scope ?? null, timeframe, window, query: rest }
			}
		}
		return undefined
	}

	/**
	 * Reads the source within the read timeout, memoizes and stores the answer (before answering
	 * with `awaitStore`); a failure is remembered for a minute and thrown classified.
	 */
	const fetchFresh = async (
		adapter: AnalyticsAdapter,
		prepared: Prepared,
		run: {
			priority: Priority
			gate?: (signal: AbortSignal) => Promise<() => void>
			recipe?: ReadRecipe
			awaitStore?: boolean
		}
	): Promise<AnalyticsResult> => {
		const { key, q, plan, clamped, range } = prepared
		const scope = q.scope ?? null
		let fresh: AnalyticsResult
		try {
			fresh = await withinTimeout(async ({ signal, deadline }) => {
				const release = await run.gate?.(signal)
				try {
					return await throughLane(adapter, (ctx) => adapter.query(prepared.adapterQuery, ctx), {
						signal,
						priority: run.priority,
						deadline,
						scope,
					})
				} finally {
					release?.()
				}
			})
		} catch (err) {
			const failure = classifyError(err)
			failures.set(key, failure, FAILURE_MEMO_MS)
			// A lane refusal sent nothing: the failure that opened or paused the lane was told already.
			if (!isLaneRefused(err)) {
				opts.onError?.(err, adapter.id)
			}
			throw new ReadFailedError(
				withLaneRetryAfter(failure, lanes.for(adapter, scope).health()),
				err
			)
		}
		failures.delete(key)
		const answered = readAt(fresh, now())
		const folded = plan ? foldResult(answered, q, plan) : answered
		const shaped = shapeResult(folded, q)
		const result: AnalyticsResult = clamped
			? {
					...shaped,
					meta: { ...shaped.meta, clamped: true, dataFrom: range.start.toISOString() },
				}
			: shaped
		// Each passes (a failed goal resolver, a stand-in zone, days still being counted) and would
		// stay pinned for the aggregate TTL; a capped read stays capped, so it keeps that TTL.
		const degraded =
			result.meta.goalsUnresolved === true ||
			result.meta.timezoneUnresolved === true ||
			(result.meta.partial?.missingDays ?? 0) > 0
		const kept = degraded
			? (opts.ttl.realtime ?? adapter.capabilities.recommendedTtl.realtime)
			: (opts.ttl.aggregate ?? adapter.capabilities.recommendedTtl.aggregate)
		const today = todayTtl(adapter, q)
		const ttl = today === undefined ? kept : Math.min(kept, today)
		memo.set(key, result, Math.min(AGGREGATE_MEMO_MS, ttl * 1000))
		// A store that is slow or hangs never holds up an answer the source already gave, nor `idle()`
		// past the read timeout.
		if (!closed) {
			const write = store(key, result, {
				ttlSeconds: ttl,
				staleSeconds: STALE_WINDOW_SECONDS,
				...(q.scope === undefined ? {} : { scope: q.scope }),
				...(run.recipe ? { recipe: run.recipe } : {}),
			})
			const stored = inBackground(
				withinBudget(write, opts.timeoutMs).then((done) => {
					if (done === OVER_BUDGET) {
						opts.onStoreError?.(
							new Error(`analytics: the read cache did not store within ${opts.timeoutMs} ms`),
							'set'
						)
					}
				})
			)
			if (run.awaitStore) {
				await stored
			}
		}
		return result
	}

	/** One read's answer as kept or fetched, and where it came from, before `hooks.afterRead`. */
	const keep = async (
		adapter: AnalyticsAdapter,
		prepared: Prepared,
		options: ReadOptions
	): Promise<Kept> => {
		const { key, q } = prepared
		const memoized = memo.get(key)
		if (memoized) return { q, result: memoized, from: 'memory' }

		const scope = q.scope ?? null
		const lane = lanes.for(adapter, scope)
		const recipe = await recipeOf(adapter, prepared, options.timeframe)
		const fetchFor = (
			priority: Priority,
			gate?: (signal: AbortSignal) => Promise<() => void>
		): Promise<AnalyticsResult> =>
			fetchFresh(adapter, prepared, {
				priority,
				...(gate ? { gate } : {}),
				...(recipe ? { recipe } : {}),
			})
		const kept = (result: AnalyticsResult, from: ReadOrigin): Kept => ({ q, result, from })

		const entry = await cached(key)
		const at = now()
		if (entry && recipe && (entry.readAt == null || at - entry.readAt >= TOUCH_EVERY_MS)) {
			opts.store
				.touch(key, new Date(at), recipe)
				.catch((err: unknown) => opts.onStoreError?.(err, 'touch'))
		}
		if (entry && entry.expiresAt > at) {
			memoizeEntry(key, entry, at)
			return kept(entry.value, 'store')
		}
		const priority = options.priority ?? 'normal'
		const usable = entry && entry.staleUntil > at ? entry : null
		// A source that bounds today's answers is read again before it answers one expired, rather
		// than serving it while a refresh runs: the expired one stands in only if that read fails.
		const allowStale = options.allowStale !== false && todayTtl(adapter, q) === undefined
		if (usable && allowStale) {
			const failure = failures.get(key)
			// A source that refuses the query as asked has nothing saved worth showing for it.
			if (failure?.kind === 'invalid_param') {
				throw new ReadFailedError(failure)
			}
			const health = lane.health()
			// An open breaker answers every refresh at once with a failure: skip it rather than log
			// one per read. Once its wait is over, the next refresh goes out as the probe.
			if (!health.open && !closed) {
				inBackground(coalesce(key, () => fetchFor('background')))
			}
			return kept(staleResult(usable, sourceErrorOf(failure, health)), 'stale')
		}
		const busy = options.whenBusy === 'refuse' && !coalesce.has(key) && !budget.available(scope)
		if (usable) {
			// Waiting for the source here is a cold read like any other, so it takes the scope's
			// place first; one refused a place falls back to the expired entry, as a failure does.
			if (busy) {
				const failure = failures.get(key)
				if (failure?.kind === 'invalid_param') {
					throw new ReadFailedError(failure)
				}
				return kept(staleResult(usable, sourceErrorOf(failure, lane.health())), 'stale')
			}
			try {
				return kept(
					await coalesce(key, () => fetchFor(priority, (signal) => budget.take(scope, signal))),
					'source'
				)
			} catch (err) {
				const failure = classifyError(err)
				if (failure.kind === 'invalid_param') {
					throw err
				}
				return kept(staleResult(usable, sourceErrorOf(failure, lane.health())), 'stale')
			}
		}
		if (busy) {
			throw new ReadFailedError(
				{ kind: 'rate_limited', retryAfterMs: BUSY_RETRY_AFTER_MS },
				new ScopeBusyError(BUSY_RETRY_AFTER_MS)
			)
		}
		const fresh = await coalesce(key, () =>
			fetchFor(priority, (signal) => budget.take(scope, signal))
		)
		return kept(fresh, 'source')
	}

	/**
	 * A window from a closed day into today, on a source that bounds today's answers, read as its
	 * closed days (kept for the aggregate TTL) and today (re-read as often as today's TTL asks).
	 */
	const keepSplit = async (
		adapter: AnalyticsAdapter,
		prepared: Prepared,
		options: ReadOptions
	): Promise<Kept | undefined> => {
		if (adapter.capabilities.recommendedTtl.today === undefined) {
			return undefined
		}
		const { q } = prepared
		const split = splitAtToday(q, todayStart(q))
		if (!split) {
			return undefined
		}
		const { timeframe: _whole, ...partOptions } = options
		const keepPart = async (part: AnalyticsQuery): Promise<Kept> =>
			keep(adapter, await prepare(adapter, part, prepared.epochs), partOptions)
		const [closedPart, todayPart] = await Promise.all([
			keepPart(split.closed),
			keepPart(split.today),
		])
		const from: ReadOrigin =
			closedPart.from === 'source' || todayPart.from === 'source'
				? 'source'
				: closedPart.from === 'stale' || todayPart.from === 'stale'
					? 'stale'
					: todayPart.from
		return { q, result: mergeAtToday(closedPart.result, todayPart.result, q), from }
	}

	return {
		async read(adapter, query, options = {}) {
			const startedAt = timerNow()
			opts.onRead?.()
			if (!adapter.isConfigured()) return emptyResult(adapter.id, now())
			checkFilters(adapter, query)
			const prepared = await prepare(adapter, query)
			const found =
				(await keepSplit(adapter, prepared, options)) ?? (await keep(adapter, prepared, options))
			return options.afterRead === false ? found.result : answered({ adapter, ...found, startedAt })
		},

		async refresh(adapter, query, options) {
			if (!adapter.isConfigured()) {
				return 'fresh'
			}
			checkFilters(adapter, query)
			const prepared = await prepare(adapter, query)
			const entry = await cached(prepared.key)
			if (entry && entry.expiresAt - now() > options.freshForMs) {
				return 'fresh'
			}
			await coalesce(prepared.key, () =>
				fetchFresh(adapter, prepared, {
					priority: options.priority ?? 'background',
					awaitStore: true,
				})
			)
			return 'refreshed'
		},
		async peek(adapter, query, options = {}) {
			const startedAt = timerNow()
			if (!adapter.isConfigured()) return emptyResult(adapter.id, now())
			checkFilters(adapter, query)
			const look = async (): Promise<Kept | null> => {
				const prepared = await prepare(adapter, query)
				const { key, q } = prepared
				const memoized = memo.get(key)
				if (memoized) {
					return { q, result: memoized, from: 'memory' }
				}
				const entry = await cached(key)
				const at = now()
				if (!entry || entry.staleUntil <= at) {
					return null
				}
				if (entry.expiresAt > at) {
					memoizeEntry(key, entry, at)
					return { q, result: entry.value, from: 'store' }
				}
				const failure = failures.get(key)
				if (failure?.kind === 'invalid_param') {
					return null
				}
				const result = staleResult(
					entry,
					sourceErrorOf(failure, lanes.for(adapter, q.scope ?? null).health())
				)
				return { q, result, from: 'stale' }
			}
			// A store or an epoch lookup that fails is a miss like any other: the caller reads instead.
			const found = await withinBudget(look(), options.budgetMs ?? PEEK_BUDGET_MS).catch(() => null)
			return found && found !== OVER_BUDGET ? answered({ adapter, ...found, startedAt }) : undefined
		},
		async realtime(adapter, query) {
			const realtime = adapter.realtime
			if (!realtime) {
				throw new Error(`analytics: the "${adapter.id}" source counts no live visitors`)
			}
			const scope = query.scope ?? null
			try {
				return await withinTimeout(({ signal, deadline }) =>
					throughLane(adapter, (ctx) => realtime.call(adapter, query, ctx), {
						signal,
						priority: 'interactive',
						deadline,
						scope,
					})
				)
			} catch (err) {
				if (!isLaneRefused(err)) {
					opts.onError?.(err, adapter.id)
				}
				throw new ReadFailedError(
					withLaneRetryAfter(classifyError(err), lanes.for(adapter, scope).health()),
					err
				)
			}
		},
		idle,
		keep(work) {
			inBackground(work)
		},
		async close() {
			closed = true
			await idle()
		},
		health(adapter, scope) {
			return lanes.for(adapter, scope ?? null).health()
		},
	}
}
