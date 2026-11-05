import type { Payload, PayloadRequest } from 'payload'
import { unsupportedFilter } from '../../core/capabilities'
import { currentDate } from '../../core/clock'
import type {
	AdapterContext,
	AnalyticsFilter,
	AnalyticsQuery,
	AnalyticsResult,
	AnalyticsRow,
	DimensionKey,
	FilterOperatorMap,
	MetricValues,
	VisitorCounting,
} from '../../core/contract'
import { MAINTAIN_INTERVAL_MS } from '../../core/jobs'
import { monotonicMs } from '../../core/monotonic'
import { AnalyticsTrackError } from '../../core/serverEvent'
import { InvalidQueryError, UnsupportedFilterError } from '../../core/sourceErrors'
import {
	addCalendarDays,
	type CalendarDay,
	calendarDayOf,
	calendarDayStart,
	calendarDaysBetween,
} from '../../timeframe/calendar'
import { AGGREGATION_VERSION, dayWindow, seamOf, startingAt } from '../store/aggregate'
import { type CardinalityCaps, DEFAULT_CAPS } from '../store/caps'
import { TWIN_WINDOW_MS, twinsWithin } from '../store/hits'
import { orderTwinOf, ulid } from '../store/ids'
import { type MetricParts, partsToMetrics, sumParts } from '../store/parts'
import { checkMatchesPattern } from '../store/pattern'
import {
	ACQUISITION_ATTRIBUTES,
	compareCodePoints,
	countedParts,
	DEFAULT_TOP,
	filterHolds,
	isRawDimension,
	partsFrom,
	type RawAxis,
	type RawDimension,
	ReadTimeoutError,
	type SessionAttribute,
	VISITOR_ATTRIBUTES,
} from '../store/rawRead'
import { DAY_LEASE_MS, dayEnd, dayFinalAfter, dayKey, heartbeatStale } from '../store/state'
import type {
	AggregateRead,
	AggregateRow,
	CompletedDayStatus,
	DayMarker,
	DayWindow,
	EventStore,
	HitRow,
	RawOrder,
	RawRead,
	RawRow,
	RealtimeCount,
	RealtimePart,
	RealtimeRead,
	RealtimeResult,
	StateStore,
	TimeWindow,
} from '../store/types'
import { MAINTAIN_TASK_SLUG } from '../tasks/maintainTask'
import { bucketInstant, foldDays } from './buckets'
import { DEFAULT_RAW_DAYS } from './capabilities'
import {
	createCostModel,
	SNAPSHOT_LONGEST_AGE_MS,
	snapshotAboveHitsOf,
	snapshotMaxAgeMs,
} from './cost'
import {
	createZoneBook,
	datesOf,
	daySpan,
	fileDayWithin,
	hourStarts,
	isClosed,
	isFixed,
	isSealed,
	type LocalDay,
	localDay,
	localDaysOf,
	markerEnd,
	markerStart,
	rawFloor,
	rawFloorDay,
	todayIn,
	windowOf,
	type ZoneSource,
} from './days'
import {
	createMaintenance,
	MAX_COUNT_ATTEMPTS,
	type MaintainInput,
	type MaintainReport,
} from './maintenance'
import {
	addInto,
	type RankedSide,
	type SideRanking,
	sumByValue,
	topAcross,
	type ValueRow,
} from './merge'
import { createNudger, NUDGE_BUDGET_MS, NUDGE_EVERY_MS } from './nudge'
import {
	type AggregateTarget,
	axisOf,
	type ClosedDaySource,
	closedDaySource,
	countsVisits,
	foldTargets,
	orderOf,
	type ReadShape,
	readFilters,
	readShape,
	runsOf,
	type SeriesUnit,
	seriesOf,
	snapshotState,
	wholeDayHits,
} from './planner'
import { type RebuildDaysInput, type RebuildDaysReport, rebuildRange } from './rebuild'

export interface EngineOptions {
	/** An unscoped install keeps every hit under `''` and ignores a read's scope. */
	scoped?: boolean
	/** Each scope's reporting zone. Without it a read is cut in the zone it names, else UTC. */
	timezone?: ZoneSource
	/**
	 * Each scope's reporting currency, undefined for none (the default): a read whose revenue adds
	 * amounts sent in several currencies then names them in `meta.mixedCurrencies`.
	 */
	currency?: (scope: string) => Promise<string | undefined>
	/** The dimensions the adapter declares; a breakdown by any other is ignored. */
	dimensions?: ReadonlySet<DimensionKey>
	/** The filters the adapter declares, the store's by default; any other is refused. */
	filters?: FilterOperatorMap
	caps?: CardinalityCaps
	/** Keeps item by page rows, as `capture.autoCapture.items.pages` decides. Default true. */
	itemPages?: boolean
	/** Days of raw hits kept, as far as filtered and hourly reads reach; null: all. Default 90. */
	rawDays?: number | null
	/** Days of daily totals kept, today counted; null keeps every day's. Default null. */
	aggregateDays?: number | null
	/**
	 * Who runs maintenance: a jobs runner whose heartbeat is judged against `intervalMs` (default
	 * 15 minutes), or, with `runner: false`, ingest alone. Default: a runner.
	 */
	maintenance?: { runner: boolean; intervalMs?: number }
	/**
	 * Uncounted closed days a read takes on, newest first, within `budgetMs` (3,000) of predicted
	 * cost: counted with no fresh runner, else read raw up to `rawDays` (7); the rest `meta.partial`.
	 */
	lazy?: { budgetMs?: number; rawDays?: number }
	/**
	 * Today is read live up to `snapshotAboveHits` hits (5,000 on Postgres, 2,000 elsewhere), else
	 * from a background snapshot served up to `maxAgeMs` old (by default scaled by hits, 1 to 5 min).
	 */
	today?: { snapshotAboveHits?: number; maxAgeMs?: number }
	/** How long one raw read may take, in ms. Default 8,000. */
	timeoutMs?: number
	/** How long a refused raw read may spend reading its days one by one, in ms. Default 4,000. */
	splitBudgetMs?: number
	/** How many days without hits one read marks `empty`, newest first. Default 31. */
	emptyMarkers?: number
	/** The clock days are cut and leases stamped by; the plugin's (`currentDate`) by default. */
	now?: () => Date
	/** Milliseconds every time budget is spent in; the monotonic clock (`monotonicMs`) by default. */
	clock?: () => number
	warn?: (message: string) => void
	/**
	 * How far apart an order's two records may lie to count as one sale, as the store counts them:
	 * `TWIN_WINDOW_MS` by default, null for any distance.
	 */
	twinWindowMs?: number | null
}

interface EngineInput {
	payload: Payload
	store: EventStore
	state: StateStore
	options?: EngineOptions
}

/** A scope's days in its zone, each window starting where `startOf` says, else at its midnight. */
export interface DaysTarget {
	scope: string
	tz: string
	startOf?: (day: CalendarDay) => Date
}

/** A local day of a scope, in the zone it is counted in. */
export interface DayTarget {
	scope: string
	day: CalendarDay
	tz: string
	/** Where its window starts, when not at its own start in `tz` (see `windowOf`). */
	start?: Date
}

/** The day a server hit is counted on, and whether that day had closed when it arrived. */
interface ServerHitDay extends DayTarget {
	closed: boolean
}

/**
 * How far ahead of the server's clock a server event's own time may be: a caller's clock a few
 * minutes fast is tolerated, a date in the future is not.
 */
export const SERVER_CLOCK_SKEW_MS = 5 * 60_000

/** What a leased run of one day did. */
export type DayRun =
	| { outcome: 'completed'; hits: number }
	/** Another run holds the day's lease. */
	| { outcome: 'busy' }
	/** The lease passed to another run before this one completed, so nothing it wrote is read. */
	| { outcome: 'lost' }
	/** Maintenance gave up on the day: counting it had started too often in vain. */
	| { outcome: 'failed' }

/**
 * One Payload instance's native engine, keyed by its caller: nothing is shared through a module, so
 * two instances in one process never share a lease, a zone or a background task.
 */
export interface NativeEngine {
	/** A read planned over aggregates, raw hits and today's snapshot, as the adapter answers. */
	read(query: AnalyticsQuery, ctx?: AdapterContext): Promise<AnalyticsResult>
	/**
	 * Who is on the site in the query's window, by the minute or ranked by page or source; a part
	 * the store cannot read fails it with the store's error (`ReadTimeoutError` when too big).
	 */
	realtime(query: AnalyticsQuery, ctx?: AdapterContext): Promise<AnalyticsResult>
	/** Aggregates a closed day under its lease, `final` once no hit can reach it. */
	aggregate(target: DayTarget): Promise<DayRun>
	/** Snapshots a day still running under its lease, as a read does for a busy site's today. */
	snapshot(target: DayTarget): Promise<DayRun>
	/** The scheduled upkeep, within its budget; a closed engine answers a run that never ran. */
	maintain(input: MaintainInput): Promise<MaintainReport>
	/** Classifies a stretch's hits again when asked, and marks its days to be counted again. */
	rebuild(input: RebuildDaysInput): Promise<RebuildDaysReport>
	/**
	 * The day a server hit at `at` counts on (see `countedDayOf`), null while its zone is unknown.
	 * Throws `AnalyticsTrackError` at or before the raw floor day, whose hits may be pruned.
	 */
	serverHitDay(scope: string, at: Date): Promise<ServerHitDay | null>
	/** Marks a day to be counted again: a server hit landed on it after it closed. */
	reopen(target: DayTarget): Promise<void>
	/**
	 * An order record (`ow.`/`os.` id) was stored: a closed day holding its twin, raw hits whole, is
	 * counted again, since the sale now counts once. Tracked, so `idle` waits for it.
	 */
	orderStored(scope: string, id: string): Promise<void>
	/**
	 * Where a refund is filed so breakdowns sum to totals: the counted record's attribution (browser
	 * within the twin window, else server), acquisition from the visitor's latest landing before it.
	 */
	saleAttribution(scope: string, sale: { wire: string; server: string }): Promise<Partial<HitRow>>
	/**
	 * What ingest calls after a hit: maintenance in the background, at most once per 10 minutes and
	 * never twice at once, sweeping salts alone while a jobs runner's heartbeat is fresh.
	 */
	nudge(): void
	/** Settles once work left running (snapshot refreshes, empty markers, maintenance) is done. */
	idle(): Promise<void>
	/** Starts no background work from now on, and settles what is running. */
	close(): Promise<void>
}

const PROVIDER = 'native'

/** Scopes, and sides of one answer, read at once. */
const CONCURRENCY = 4

/** Busy days remembered at most, all forgotten at once past it: a few per scope at a time. */
const MAX_BUSY_DAYS = 10_000

/** Markers a read over many scopes holds at once; past it each scope reads its own as it plans. */
const MAX_KNOWN_MARKERS = 50_000

/** Local days a scope's read plans day by day before it first asks where its data starts. */
const LONG_SPAN_DAYS = 400

/** How often a run counting a day renews its lease: three times within each lease. */
const DAY_LEASE_RENEW_MS = Math.floor(DAY_LEASE_MS / 3)

interface Settings {
	scoped: boolean
	caps: CardinalityCaps
	itemPages: boolean
	rawDays: number | null
	aggregateDays: number | null
	runner: boolean
	maintainIntervalMs: number
	lazyBudgetMs: number
	lazyRawDays: number
	snapshotAboveHits: number
	/** A snapshot's longest age when the install fixes one; null scales it by its hits. */
	snapshotMaxAgeMs: number | null
	timeoutMs: number
	splitBudgetMs: number
	emptyMarkers: number
	now: () => Date
	clock: () => number
	twinWindowMs: number | null
}

/** An option that is a whole number of at least `min`, its default when absent. */
const wholeOption = (
	name: string,
	value: number | undefined,
	spec: { fallback: number; min: number }
) => {
	const resolved = value ?? spec.fallback
	if (!Number.isInteger(resolved) || resolved < spec.min) {
		throw new Error(
			`analytics: the native engine's ${name} must be a whole number of at least ${spec.min}, got ${resolved}`
		)
	}
	return resolved
}

const settingsOf = (options: EngineOptions, store: Pick<EventStore, 'id'>): Settings => ({
	scoped: options.scoped ?? false,
	caps: options.caps ?? DEFAULT_CAPS,
	itemPages: options.itemPages ?? true,
	rawDays:
		options.rawDays === null
			? null
			: wholeOption('rawDays', options.rawDays, { fallback: DEFAULT_RAW_DAYS, min: 1 }),
	aggregateDays:
		options.aggregateDays === undefined || options.aggregateDays === null
			? null
			: wholeOption('aggregateDays', options.aggregateDays, { fallback: 1, min: 1 }),
	runner: options.maintenance?.runner ?? true,
	maintainIntervalMs: wholeOption('maintenance.intervalMs', options.maintenance?.intervalMs, {
		fallback: MAINTAIN_INTERVAL_MS,
		min: 1,
	}),
	lazyBudgetMs: wholeOption('lazy.budgetMs', options.lazy?.budgetMs, { fallback: 3_000, min: 0 }),
	lazyRawDays: wholeOption('lazy.rawDays', options.lazy?.rawDays, { fallback: 7, min: 0 }),
	snapshotAboveHits: wholeOption('today.snapshotAboveHits', options.today?.snapshotAboveHits, {
		fallback: snapshotAboveHitsOf(store),
		min: 0,
	}),
	snapshotMaxAgeMs:
		options.today?.maxAgeMs === undefined
			? null
			: wholeOption('today.maxAgeMs', options.today.maxAgeMs, { fallback: 0, min: 0 }),
	timeoutMs: wholeOption('timeoutMs', options.timeoutMs, { fallback: 8_000, min: 1 }),
	splitBudgetMs: wholeOption('splitBudgetMs', options.splitBudgetMs, { fallback: 4_000, min: 0 }),
	emptyMarkers: wholeOption('emptyMarkers', options.emptyMarkers, { fallback: 31, min: 0 }),
	now: options.now ?? currentDate,
	clock: options.clock ?? monotonicMs,
	twinWindowMs: options.twinWindowMs === undefined ? TWIN_WINDOW_MS : options.twinWindowMs,
})

const attributesOf = (hit: HitRow, fields: readonly SessionAttribute[]): Partial<HitRow> => {
	const kept: Partial<HitRow> = {}
	for (const field of fields) {
		const value = hit[field]
		if (value !== undefined) {
			kept[field] = value
		}
	}
	return kept
}

/** The day a hit is counted on, the window that count reads, and what says whether it is fixed. */
interface CountedDay {
	day: CalendarDay
	window: LocalDay
	marker: DayMarker | undefined
	prunedBefore: Date | null
}

/** A stretch of one scope's range read from its raw hits, or of several cut alike. */
interface RawWindow {
	scope: string
	/** Every scope it reads, when merged across scopes (see `mergeWindows`); `scope` is the first. */
	scopes?: readonly string[]
	start: Date
	end: Date
	/** Where visits are cut from: its first day's start, so a visit begun earlier keeps its entry. */
	from: Date
	/** Its local days, oldest first. */
	days: LocalDay[]
	/** Its totals, once read. */
	totals?: MetricParts
	/** Each scope's today, read live; once refused, it is read from a snapshot from then on. */
	today?: readonly DayTarget[]
}

/** One scope's days read from aggregate rows, as ranges of dates, or several scopes' alike. */
interface AggregateSpan {
	scope: string
	/** Every scope it reads, when merged across scopes (see `mergeSpans`); `scope` is the first. */
	scopes?: readonly string[]
	days: Array<[CalendarDay, CalendarDay]>
}

/** How many scopes a window reads: a day it leaves unread is missing for each of them. */
const widthOf = (window: Pick<AggregateSpan, 'scopes'>): number => window.scopes?.length ?? 1

/** The scope fields a store read takes for a window or a span: its one scope, or all it merged. */
const scopeFields = (
	part: Pick<AggregateSpan, 'scope' | 'scopes'>
): { scope: string } | { scopes: readonly string[] } =>
	part.scopes !== undefined && part.scopes.length > 1
		? { scopes: part.scopes }
		: { scope: part.scope }

/** How one scope's part of a read is answered. */
interface ScopePlan {
	aggregates: AggregateSpan | null
	raw: RawWindow[]
	/** Days of the range that cannot be read now. */
	missing: number
	/** Days read from rows that folded a value the read asks about, past raw retention. */
	capped: number
	/** Days maintenance gave up counting: read from an earlier count, or left out. */
	failed: number
	/** Cut in a stand-in zone: no zone resolved or was recorded. */
	standIn: boolean
	/** When the oldest snapshot it reads was taken. */
	asOf?: Date
	/** Where its raw reads start instead of the range's start. */
	clampedTo?: Date
	/** Where its data ends instead of the range's end: a cut last day past raw retention. */
	endsAt?: Date
	/** Local days of the range up to today. */
	dayCount: number
}

type Side = { kind: 'aggregates'; span: AggregateSpan } | { kind: 'raw'; window: RawWindow }

/** One read, decided once and handed through planning and answering. */
interface Read {
	query: AnalyticsQuery
	now: Date
	start: Date
	/** Exclusive: the query's end is the last instant it reads. */
	end: Date
	filters: AnalyticsFilter[]
	breakdown: RawDimension | undefined
	series: SeriesUnit | undefined
	shape: ReadShape
	/** What a breakdown counts, which decides its default order. */
	axis: RawAxis
	/** What the totals count: those of the filters alone, the same with or without a breakdown. */
	totalAxis: RawAxis
	order: RawOrder
	visits: boolean
	signal?: AbortSignal
	/** Wall-clock instant by which the work a read takes on for uncounted days must be done. */
	lazyUntil: number
	/**
	 * How long one statement may hold up this thread, where statements do (the store's
	 * `blockingBudgetMs`): no count or raw read predicted past it is started. Null: no such bound.
	 */
	stall: number | null
	/** The predicted cost of the raw reads planned for uncounted days, spent from the budget. */
	planned: { ms: number }
	/** Whether a jobs runner's heartbeat is fresh, asked at most once per read. */
	runner: { fresh?: Promise<boolean> }
	/** Closed days the read left uncounted, out of its answer or read raw: any start maintenance. */
	uncounted: { count: number }
	/** Empty markers this read may still write. */
	emptyLeft: { count: number }
	/** Snapshots to take once it has answered: stale ones it served, and a first for a busy today. */
	refresh: DayTarget[]
	/** Each scope's reporting currency, asked at most once per read. */
	currencies: Map<string, Promise<string | undefined>>
	/** The scopes' state rows read up front for a read of many scopes, else read scope by scope. */
	known?: KnownState
}

/** Several scopes' day markers and prune cuts, read in one statement each rather than per scope. */
interface KnownState {
	/** Each scope's markers over the days every scope's read covers; absent: read anew. */
	markers?: Map<string, readonly DayMarker[]>
	pruned: ReadonlyMap<string, Date>
	/** Each scope's hits today so far, counted no further than reading it live allows. */
	today?: ReadonlyMap<string, { start: number; end: number; hits: number }>
}

/** One scope's part of a read, while it is planned. */
interface ScopeRead {
	read: Read
	scope: string
	tz: string
	plan: ScopePlan
	/** The scope's zone is a stand-in, so the read writes nothing: no count, snapshot or marker. */
	standIn: boolean
	/** Before it the scope's raw hits may be gone; null while none ever were. */
	prunedBefore: Date | null
	/** From where raw hits are both complete and within retention; undefined: every one. */
	rawFrom: Date | undefined
}

/** Days a scope's plan has sorted so far, by where they are read from. */
interface Sorted {
	markers: ReadonlyMap<CalendarDay, DayMarker>
	/** Each day's window, from where a fixed day before it ended (see `windowOf`). */
	windowFor: (day: CalendarDay) => LocalDay
	/** Read from their aggregate rows (today's snapshot among them). */
	aggregated: CalendarDay[]
	/** Hold no rows: bridged over when the aggregated days are read as ranges. */
	empty: CalendarDay[]
}

const later = (a: Date | undefined, b: Date | undefined): Date | undefined =>
	a === undefined ? b : b === undefined || a >= b ? a : b

const earlier = (a: Date | undefined, b: Date | undefined): Date | undefined =>
	a === undefined ? b : b === undefined || a <= b ? a : b

const minDate = (a: Date, b: Date): Date => (a <= b ? a : b)
const maxDate = (a: Date, b: Date): Date => (a >= b ? a : b)

/** A read's row limit: none unless a whole number above zero. */
const limitOf = (query: Pick<AnalyticsQuery, 'limit'>): number | undefined =>
	query.limit !== undefined && Number.isInteger(query.limit) && query.limit > 0
		? query.limit
		: undefined

/** `work`'s answer, or `refused`'s when the store refused it as too big or slow; else it throws. */
const unlessRefused = async <T>(
	work: () => Promise<T>,
	refused: () => T | Promise<T>
): Promise<T> => {
	try {
		return await work()
	} catch (err) {
		if (!(err instanceof ReadTimeoutError)) {
			throw err
		}
		return refused()
	}
}

/** One day of a raw window, cut to the window's own instants. */
const dayOfWindow = (window: RawWindow, day: LocalDay): RawWindow => ({
	scope: window.scope,
	...(window.scopes === undefined ? {} : { scopes: window.scopes }),
	start: maxDate(window.start, day.start),
	end: minDate(window.end, day.end),
	from: day.start,
	days: [day],
})

/** Runs `work` over `items` with at most `limit` running at once, answering in order. */
const mapLimited = async <T, R>(
	items: readonly T[],
	limit: number,
	work: (item: T) => Promise<R>
): Promise<R[]> => {
	const results = new Map<number, R>()
	let next = 0
	const worker = async (): Promise<void> => {
		while (next < items.length) {
			const index = next++
			const item = items[index]
			if (item !== undefined) {
				results.set(index, await work(item))
			}
		}
	}
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
	return items.flatMap((_, index) => {
		const result = results.get(index)
		return result === undefined ? [] : [result]
	})
}

/**
 * Ascending ranges for an aggregate read: runs of the days to read, bridged over days holding no
 * rows (no hits, so no generation a read would count), never over any other day.
 */
const aggregateRanges = (sorted: Sorted): Array<[CalendarDay, CalendarDay]> => {
	const reading = new Set(sorted.aggregated)
	const runs = runsOf([...new Set([...sorted.aggregated, ...sorted.empty])].sort((a, b) => a - b))
	const ranges: Array<[CalendarDay, CalendarDay]> = []
	for (const [first, last] of runs) {
		const days = datesOf(first, last).filter((day) => reading.has(day))
		const from = days[0]
		const to = days.at(-1)
		if (from !== undefined && to !== undefined) {
			ranges.push([from, to])
		}
	}
	return ranges
}

const valueRowsOf = (rows: readonly (RawRow | AggregateRow)[]): ValueRow[] =>
	rows.flatMap((row) =>
		row.value === null || row.value === '' ? [] : [{ value: row.value, parts: row.parts }]
	)

/** The window a day target is counted over: its day in its zone, from its own `start` if set. */
const countedWindow = (target: DayTarget): DayWindow =>
	startingAt(dayWindow(target.scope, target.day, target.tz), target.start)

/** The instants a day target's hits lie between, as the store counts or probes them. */
const hitsWindow = (target: DayTarget): TimeWindow => ({
	scope: target.scope,
	start: target.start ?? calendarDayStart(target.day, target.tz),
	end: dayEnd(target.day, target.tz),
})

const emptyMarker = (target: DayTarget, at: Date): DayMarker => ({
	scope: target.scope,
	day: target.day,
	tz: target.tz,
	start: seamOf(countedWindow(target)),
	status: 'empty',
	version: AGGREGATION_VERSION,
	gen: null,
	hits: 0,
	leaseOwner: null,
	leaseUntil: null,
	finalAfter: dayFinalAfter(target.day, target.tz),
	aggregatedAt: at,
})

/**
 * Reads planned per local day over aggregates, raw hits and today's snapshot, unaggregated closed
 * days aggregated lazily, and the leased day runs.
 */
export const createEngine = (input: EngineInput): NativeEngine => {
	const { payload, store, state } = input
	const options = input.options ?? {}
	const settings = settingsOf(options, store)
	const warn = options.warn ?? ((message: string) => payload.logger.warn(message))
	const zones = createZoneBook(options.timezone, warn, (scope) => state.lastZone(scope))
	const filterMap = options.filters ?? store.features.filters
	const breakdowns = options.dimensions
	const instance = `engine:${ulid(settings.now())}`
	/** A fresh lease owner for each lease this engine takes. */
	const newOwner = (): string => `${instance}:${ulid(settings.now())}`
	const running = new Set<Promise<unknown>>()
	const refreshing = new Map<string, Promise<void>>()
	/** Days still running found too busy to read live, which they stay as their hits only grow. */
	const busyDays = new Set<string>()
	const cost = createCostModel(store)
	let closed = false

	const zeroParts = (read: Read): MetricParts =>
		partsFrom(countedParts(read.totalAxis, read.visits), () => 0)

	/** Counts `task` as running until it settles, so `idle` and `close` wait for it. */
	const track = <T>(task: Promise<T>): Promise<T> => {
		const settled = task.then(
			() => undefined,
			() => undefined
		)
		running.add(settled)
		void settled.then(() => running.delete(settled))
		return task
	}

	/** Work nobody awaits, its failure logged; none starts once the engine is closed. */
	const background = (what: string, work: () => Promise<void>): Promise<void> =>
		closed
			? Promise.resolve()
			: track(
					work().catch((err: unknown) => {
						warn(`analytics: ${what} failed: ${String(err)}`)
					})
				)

	/**
	 * Notes one more attempt at counting a day the run holds, or gives up on it once counting it
	 * has started `MAX_COUNT_ATTEMPTS` times without completing: a crash counts as well as a throw.
	 */
	const attemptDay = async (
		target: DayTarget,
		owner: string
	): Promise<'counting' | 'failed' | 'lost'> => {
		const [held] = await state.markers(target.scope, target.day, target.day)
		if (held?.leaseOwner !== owner) {
			return 'lost'
		}
		const failures = held.failures ?? 0
		if (failures >= MAX_COUNT_ATTEMPTS) {
			return (await state.attempt({ ...held, status: 'failed' }, owner)) ? 'failed' : 'lost'
		}
		return (await state.attempt({ ...held, failures: failures + 1 }, owner)) ? 'counting' : 'lost'
	}

	/** A leased count of one day; `timeoutMs` bounds a count a read started (see `AggregateRun`). */
	const runDay = async (
		target: DayTarget,
		status: CompletedDayStatus,
		options: { attempt?: boolean; timeoutMs?: number } = {}
	): Promise<DayRun> => {
		const key = dayKey(target.scope, target.day)
		const runId = newOwner()
		if (!(await state.claim(key, runId, DAY_LEASE_MS))) {
			return { outcome: 'busy' }
		}
		let completed = false
		// A count that outlasts the lease would let another run in to count the day again.
		const renewal = setInterval(() => {
			state.renew(key, runId, DAY_LEASE_MS).catch(() => false)
		}, DAY_LEASE_RENEW_MS)
		renewal.unref?.()
		try {
			if (options.attempt === true) {
				const attempt = await attemptDay(target, runId)
				if (attempt !== 'counting') {
					return { outcome: attempt }
				}
			}
			const started = settings.clock()
			const result = await store.aggregateDay(countedWindow(target), {
				runId,
				caps: settings.caps,
				status,
				itemPages: settings.itemPages,
				...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
			})
			if (result.completed) {
				cost.observe(result.hits, settings.clock() - started)
			}
			completed = result.completed
			return result.completed ? { outcome: 'completed', hits: result.hits } : { outcome: 'lost' }
		} finally {
			clearInterval(renewal)
			if (!completed) {
				await state.release(key, runId).catch(() => false)
			}
		}
	}

	const closedStatus = (target: Pick<DayTarget, 'day' | 'tz'>): CompletedDayStatus =>
		isSealed(target.day, target.tz, settings.now()) ? 'final' : 'provisional'

	const snapshotDay = async (target: DayTarget, timeoutMs?: number): Promise<DayRun> => {
		await state.ensureMarkers([target])
		return runDay(target, 'partial', timeoutMs === undefined ? {} : { timeoutMs })
	}

	/**
	 * A window's hits when reading or counting them is predicted to fit in `ms`, by a count off the
	 * index that stops just past what fits; null when they do not.
	 */
	const hitsWithin = async (window: TimeWindow, ms: number): Promise<number | null> => {
		const fit = cost.hitsReadableIn(ms)
		if (fit === 0) {
			return null
		}
		const hits = await store.countHits(window, fit)
		return hits <= fit ? hits : null
	}

	/** Whether counting a day's hits is predicted to hold up the thread no longer than `stallMs`. */
	const countFits = async (target: DayTarget, stallMs: number): Promise<boolean> =>
		(await hitsWithin(hitsWindow(target), stallMs)) !== null

	/** Retakes a day's snapshot in the background, unless its count would outlast `stall`. */
	const refresh = (target: DayTarget, stall: number | null): void => {
		const key = JSON.stringify([target.scope, target.day])
		if (refreshing.has(key)) {
			return
		}
		const task = background(`refreshing the snapshot of ${target.day}`, async () => {
			if (stall === null || (await countFits(target, stall))) {
				await snapshotDay(target, settings.timeoutMs)
			}
		})
		refreshing.set(key, task)
		void task.then(() => refreshing.delete(key))
	}

	/**
	 * Marks a day empty under its lease, probing again once it is held: a backdated server hit stored
	 * before the claim is found here, and one stored after revokes the lease so completion fails.
	 */
	const emptyDay = async (target: DayTarget): Promise<boolean> => {
		const key = dayKey(target.scope, target.day)
		const runId = newOwner()
		if (!(await state.claim(key, runId, DAY_LEASE_MS))) {
			return false
		}
		let completed = false
		try {
			const hits = await store.hasHits(hitsWindow(target))
			completed =
				!hits && (await state.complete(emptyMarker(target, settings.now()), runId, { clean: true }))
			return completed
		} finally {
			if (!completed) {
				await state.release(key, runId).catch(() => false)
			}
		}
	}

	/**
	 * Marks days without hits empty, each under its lease, until `stop`; answers how many it
	 * marked. The target's `startOf` gives a day's window start where it is not the day's own.
	 */
	const emptyDays = async (
		target: DaysTarget,
		days: readonly CalendarDay[],
		stop: () => boolean
	): Promise<number> => {
		const { scope, tz, startOf } = target
		let marked = 0
		for (const day of days) {
			if (stop()) {
				break
			}
			// One at a time: a run stopped midway leaves no open marker a read would then wait on.
			await state.ensureMarkers([{ scope, day, tz }])
			const start = startOf?.(day)
			if (await emptyDay({ scope, day, tz, ...(start ? { start } : {}) })) {
				marked += 1
			}
		}
		return marked
	}

	const markEmpty = (
		at: ScopeRead,
		days: readonly CalendarDay[],
		startOf: (day: CalendarDay) => Date
	): void => {
		if (days.length === 0 || at.standIn) {
			return
		}
		void background('marking days without hits', async () => {
			await emptyDays({ ...at, startOf }, days, () => closed)
		})
	}

	/**
	 * Whether each date of a run has hits: one probe for a run without, halved while it has some.
	 * A run starts where the target's `startOf` says its first day's window does.
	 */
	const probe = async (
		at: DaysTarget,
		[first, last]: readonly [CalendarDay, CalendarDay],
		found: { hits: CalendarDay[]; none: CalendarDay[] }
	): Promise<void> => {
		const has = await store.hasHits({
			scope: at.scope,
			start: at.startOf?.(first) ?? calendarDayStart(first, at.tz),
			end: dayEnd(last, at.tz),
		})
		if (!has) {
			for (const day of datesOf(first, last)) {
				found.none.push(day)
			}
			return
		}
		if (first === last) {
			found.hits.push(first)
			return
		}
		const middle = addCalendarDays(first, Math.floor(calendarDaysBetween(first, last) / 2))
		await probe(at, [first, middle], found)
		await probe(at, [addCalendarDays(middle, 1), last], found)
	}

	const probeRun = async (
		target: DaysTarget,
		run: readonly [CalendarDay, CalendarDay]
	): Promise<{ hits: CalendarDay[]; none: CalendarDay[] }> => {
		const found: { hits: CalendarDay[]; none: CalendarDay[] } = { hits: [], none: [] }
		await probe(target, run, found)
		return found
	}

	/** Raw hits are complete and within retention from `start` on. */
	const rawCovers = (at: ScopeRead, start: Date): boolean =>
		at.rawFrom === undefined || start >= at.rawFrom

	const rawBase = (read: Read, window: RawWindow): RawRead => ({
		...scopeFields(window),
		start: window.start,
		end: window.end,
		from: window.from,
		...(read.query.hostname === undefined ? {} : { hostname: read.query.hostname }),
		filters: read.filters,
		sessions: read.visits,
		timeoutMs: settings.timeoutMs,
		...(read.signal ? { signal: read.signal } : {}),
	})

	const rawTotals = async (read: Read, window: RawWindow): Promise<MetricParts> => {
		const [row] = await store.readRaw(rawBase(read, window))
		return row?.parts ?? zeroParts(read)
	}

	const aggregateRead = (
		read: Read,
		span: AggregateSpan,
		target: AggregateTarget & Pick<AggregateRead, 'groupBy'> & Partial<AggregateRead>
	): AggregateRead => ({
		...target,
		...scopeFields(span),
		days: span.days,
		...(read.query.hostname === undefined ? {} : { hostname: read.query.hostname }),
		...(read.signal ? { signal: read.signal } : {}),
	})

	/**
	 * A read only raw hits can answer: its range from where they cover it on, as one window, never
	 * from before `dataFrom`, the start of the day of the scope's oldest hit.
	 */
	const planRaw = (at: ScopeRead, dataFrom?: Date): ScopePlan => {
		const { read, scope, tz, plan, rawFrom } = at
		const today = localDay(todayIn(read.now, tz), tz)
		const clamped = rawFrom !== undefined && read.start < rawFrom
		const start = maxDate(clamped ? rawFrom : read.start, dataFrom ?? read.start)
		const end = minDate(read.end, today.end)
		const days = localDaysOf(start, end, tz)
		const [first] = days
		return {
			...plan,
			...(clamped ? { clampedTo: rawFrom } : {}),
			raw: first ? [{ scope, start, end, from: first.start, days }] : [],
		}
	}

	/** What is left of a read's budget for uncounted days, the raw reads planned for them spent. */
	const roomOf = (read: Read): number =>
		read.signal?.aborted ? 0 : read.lazyUntil - settings.clock() - read.planned.ms

	/** Whether a runner's heartbeat is fresh, so its next run counts what a read finds uncounted. */
	const runnerFresh = (read: Read): Promise<boolean> => {
		read.runner.fresh ??= settings.runner
			? state.lastBeat(MAINTAIN_TASK_SLUG).then(
					(beat) => !heartbeatStale(beat, settings.maintainIntervalMs, settings.now()),
					() => false
				)
			: Promise.resolve(false)
		return read.runner.fresh
	}

	/** A day left uncounted: missing from the answer, and a reason to start maintenance. */
	const skip = (read: Read, plan: ScopePlan): void => {
		plan.missing += 1
		read.uncounted.count += 1
	}

	const maxAgeOf = (hits: number): number =>
		settings.snapshotMaxAgeMs ?? snapshotMaxAgeMs(hits, cost.readMs(hits))

	const busyKey = (target: DayTarget): string =>
		JSON.stringify([target.scope, target.day, target.start?.getTime() ?? null])

	const markBusy = (target: DayTarget): void => {
		if (busyDays.size >= MAX_BUSY_DAYS) {
			busyDays.clear()
		}
		busyDays.add(busyKey(target))
	}

	/**
	 * Whether a day still running holds more hits than are read live, by a count that stops just
	 * past the threshold; a day found so stays so.
	 */
	const isBusy = async (target: DayTarget, local: LocalDay, counted?: number): Promise<boolean> => {
		if (busyDays.has(busyKey(target))) {
			return true
		}
		const hits =
			counted ??
			(await store.countHits(
				{ scope: target.scope, start: local.start, end: local.end },
				settings.snapshotAboveHits
			))
		if (hits <= settings.snapshotAboveHits) {
			return false
		}
		markBusy(target)
		return true
	}

	/** Today's live read was refused: it is read from a snapshot from now on, the first taken now. */
	const refuseLive = (target: DayTarget, stall: number | null): void => {
		markBusy(target)
		refresh(target, stall)
	}

	/** What is left of a read's budget for one statement: its room, at most its stall bound. */
	const statementRoom = (read: Read): number =>
		read.stall === null ? roomOf(read) : Math.min(roomOf(read), read.stall)

	/**
	 * Today: live while it holds few hits, else from its snapshot. Without one, a snapshot is taken
	 * after the read answers, and meanwhile the day is read raw if its cost fits, else left out.
	 */
	const planLive = async (at: ScopeRead, local: LocalDay, sorted: Sorted): Promise<void> => {
		const { read, scope, tz, plan } = at
		const target: DayTarget = { scope, day: local.day, tz, start: local.start }
		const window: RawWindow = {
			scope,
			start: local.start,
			end: minDate(read.end, local.end),
			from: local.start,
			days: [local],
		}
		if (at.standIn) {
			plan.raw.push(window)
			return
		}
		const known = read.known?.today?.get(scope)
		const counted =
			known?.start === local.start.getTime() && known.end === local.end.getTime()
				? known.hits
				: undefined
		if (!(await isBusy(target, local, counted))) {
			plan.raw.push({ ...window, today: [target] })
			return
		}
		const marker = sorted.markers.get(local.day)
		const snapshot = snapshotState(marker, {
			tz,
			window: local,
			now: read.now,
			maxAgeMs: maxAgeOf,
		})
		if (snapshot !== 'none' && marker?.aggregatedAt) {
			sorted.aggregated.push(local.day)
			plan.asOf = earlier(plan.asOf, marker.aggregatedAt)
			if (snapshot === 'stale') {
				read.refresh.push(target)
			}
			return
		}
		read.refresh.push(target)
		const hits = await hitsWithin(
			{ scope, start: local.start, end: local.end },
			statementRoom(read)
		)
		if (hits !== null) {
			read.planned.ms += cost.readMs(hits)
			plan.raw.push(window)
			return
		}
		plan.missing += 1
	}

	/**
	 * Closed days without rows, newest first, while their cost fits: counted with no fresh runner,
	 * else read raw (at most `lazy.rawDays`), the rest left out. A stand-in zone counts none.
	 */
	const planUnread = async (
		at: ScopeRead,
		unaggregated: readonly CalendarDay[],
		sorted: Sorted
	): Promise<void> => {
		if (unaggregated.length === 0) {
			return
		}
		const { read, scope, tz, plan } = at
		const { windowFor, markers } = sorted
		const counting = !at.standIn && !(await runnerFresh(read))
		const raw: CalendarDay[] = []
		for (const day of [...unaggregated].sort((a, b) => b - a)) {
			const window = windowFor(day)
			const room = statementRoom(read)
			const reading = raw.length < settings.lazyRawDays
			const fit = counting || reading ? cost.hitsReadableIn(room) : 0
			const hits =
				fit === 0
					? null
					: (wholeDayHits(markers.get(day), window) ??
						(await store.countHits({ scope, start: window.start, end: window.end }, fit)))
			const canCount = hits !== null && counting && cost.readMs(hits) <= room
			const canRead = hits !== null && reading && cost.readMs(hits) <= room
			if (hits === null || !(canCount || canRead)) {
				skip(read, plan)
				continue
			}
			if (canCount) {
				const target: DayTarget = { scope, day, tz, start: window.start }
				await state.ensureMarkers([{ scope, day, tz }])
				const counted = runDay(target, closedStatus(target), { timeoutMs: settings.timeoutMs })
				const run = await counted.catch((err: unknown): DayRun => {
					warn(`analytics: aggregating ${day} of scope "${scope}" failed: ${String(err)}`)
					return { outcome: 'lost' }
				})
				if (run.outcome === 'completed') {
					sorted.aggregated.push(day)
					// Read again by a later plan of this read (its totals'), as it was counted now.
					read.known?.markers?.delete(scope)
					continue
				}
			}
			if (canRead) {
				raw.push(day)
				read.planned.ms += cost.readMs(hits)
				read.uncounted.count += 1
			} else {
				skip(read, plan)
			}
		}
		pushRawRuns(at, raw, windowFor)
	}

	/** Days read from their raw hits instead, as one window per run of consecutive days. */
	const pushRawRuns = (
		at: ScopeRead,
		days: readonly CalendarDay[],
		windowFor: (day: CalendarDay) => LocalDay
	): void => {
		for (const [first, last] of runsOf([...days].sort((a, b) => a - b))) {
			const windows = datesOf(first, last).map(windowFor)
			const [head] = windows
			const tail = windows.at(-1)
			if (head && tail) {
				at.plan.raw.push({
					scope: at.scope,
					start: head.start,
					end: minDate(at.read.end, tail.end),
					from: head.start,
					days: windows,
				})
			}
		}
	}

	/**
	 * The days read from rows on which a value the read asks about was folded into `(other)`: read
	 * from their raw hits while those are kept, else read as they are and counted as capped.
	 */
	const planFolded = async (at: ScopeRead, sorted: Sorted): Promise<void> => {
		const { read, scope, plan } = at
		const { windowFor } = sorted
		const targets = foldTargets(read.shape)
		if (targets.length === 0 || sorted.aggregated.length === 0) {
			return
		}
		const days = runsOf([...new Set(sorted.aggregated)].sort((a, b) => a - b))
		const folded = new Set<CalendarDay>()
		for (const target of targets) {
			const found = await store.foldedDays({
				scope,
				days,
				...(read.query.hostname === undefined ? {} : { hostname: read.query.hostname }),
				...target,
			})
			for (const day of found) {
				folded.add(day)
			}
		}
		if (folded.size === 0) {
			return
		}
		const kept: CalendarDay[] = []
		const raw: CalendarDay[] = []
		for (const day of sorted.aggregated) {
			if (!folded.has(day)) {
				kept.push(day)
			} else if (
				!isFixed(sorted.markers.get(day), at.prunedBefore) &&
				rawCovers(at, windowFor(day).start)
			) {
				raw.push(day)
			} else {
				kept.push(day)
				plan.capped += 1
			}
		}
		sorted.aggregated.splice(0, sorted.aggregated.length, ...kept)
		pushRawRuns(at, raw, windowFor)
	}

	/**
	 * A day the range cuts past raw retention, which no later count can cut: nothing when it held no
	 * hits, else the read starts after it or ends before it, and says so (`clamped`).
	 */
	const planPastRaw = async (
		at: ScopeRead,
		local: LocalDay,
		marker: DayMarker | undefined
	): Promise<void> => {
		const { read, scope, plan } = at
		const held =
			marker === undefined
				? await store.hasHits({
						scope,
						start: maxDate(read.start, local.start),
						end: minDate(read.end, local.end),
					})
				: marker.status !== 'empty' && marker.hits !== 0
		if (!held) {
			return
		}
		if (local.start < read.start) {
			plan.clampedTo = later(plan.clampedTo, local.end)
		} else {
			plan.endsAt = earlier(plan.endsAt, local.start)
		}
	}

	/**
	 * A read aggregates can answer: each local day from its rows, its raw hits, or a snapshot. The
	 * scope's markers from the day before `first` are read unless `span.markers` holds them.
	 */
	const planDays = async (
		at: ScopeRead,
		span: { first: CalendarDay; last: CalendarDay; markers?: readonly DayMarker[] }
	) => {
		const { read, scope, tz, plan } = at
		const { first, last } = span
		const before = addCalendarDays(first, -1)
		const markers = new Map<CalendarDay, DayMarker>()
		const known = span.markers ?? read.known?.markers?.get(scope)
		for (const marker of known ?? (await state.markers(scope, before, last))) {
			if (marker.day >= before && marker.day <= last) {
				markers.set(marker.day, marker)
			}
		}
		const windowFor = (day: CalendarDay): LocalDay =>
			windowOf(day, { tz, markers, prunedBefore: at.prunedBefore })
		const startOf = (day: CalendarDay): Date => windowFor(day).start
		const today = todayIn(read.now, tz)
		const yesterday = addCalendarDays(today, -1)
		const todayLocal = windowFor(today)
		const yesterdayLocal = windowFor(yesterday)
		const yesterdayLive = !isClosed(yesterdayLocal, read.now)
		const startsLate = read.start > calendarDayStart(first, tz)
		const reachesNow =
			read.end.getTime() >=
			read.now.getTime() - (settings.snapshotMaxAgeMs ?? SNAPSHOT_LONGEST_AGE_MS)
		const edges: LocalDay[] = []
		const live: LocalDay[] = []
		const closed: CalendarDay[] = []
		for (const day of datesOf(first, last)) {
			const cutAtStart = day === first && startsLate
			if (day === today || (day === yesterday && yesterdayLive)) {
				const local = day === today ? todayLocal : yesterdayLocal
				if (cutAtStart || !(read.end >= local.end || reachesNow)) {
					edges.push(local)
				} else {
					live.push(local)
				}
			} else if (cutAtStart || (day === last && read.end < dayEnd(day, tz))) {
				edges.push(windowFor(day))
			} else {
				closed.push(day)
			}
		}
		const sorted: Sorted = { markers, windowFor, aggregated: [], empty: [] }
		const probing: CalendarDay[] = []
		const unaggregated: CalendarDay[] = []
		const failed: CalendarDay[] = []
		const bySource: Record<ClosedDaySource, CalendarDay[]> = {
			aggregates: sorted.aggregated,
			empty: sorted.empty,
			probe: probing,
			aggregate: unaggregated,
			failed,
		}
		for (const day of closed) {
			const marker = markers.get(day)
			const source = closedDaySource({
				marker,
				tz,
				window: windowFor(day),
				fixed: isFixed(marker, at.prunedBefore),
			})
			bySource[source].push(day)
		}
		for (const day of failed) {
			plan.failed += 1
			if ((markers.get(day)?.gen ?? null) !== null) {
				sorted.aggregated.push(day)
			}
		}
		const found: { hits: CalendarDay[]; none: CalendarDay[] } = { hits: [], none: [] }
		for (const run of runsOf(probing)) {
			await probe({ ...at, startOf }, run, found)
		}
		for (const day of found.none) {
			sorted.empty.push(day)
		}
		const horizon = rawFloorDay(today, settings.rawDays ?? DEFAULT_RAW_DAYS)
		const toMark = found.none
			.filter((day) => day >= horizon && isSealed(day, tz, read.now))
			.sort((a, b) => b - a)
			.slice(0, read.emptyLeft.count)
		read.emptyLeft.count -= toMark.length
		markEmpty(at, toMark, startOf)
		await planUnread(at, [...unaggregated, ...found.hits], sorted)
		for (const local of live) {
			await planLive(at, local, sorted)
		}
		await planFolded(at, sorted)
		for (const local of edges) {
			const start = maxDate(read.start, local.start)
			if (!rawCovers(at, start)) {
				await planPastRaw(at, local, markers.get(local.day))
				continue
			}
			plan.raw.push({
				scope,
				start,
				end: minDate(read.end, local.end),
				from: local.start,
				days: [local],
			})
		}
		const ranges = aggregateRanges(sorted)
		return { ...plan, aggregates: ranges.length > 0 ? { scope, days: ranges } : null }
	}

	/**
	 * The local days of a scope's part of a read, up to today, and where they start instead of the
	 * range's first date when `aggregateDays` deleted the days before; null when it reads none.
	 */
	const daysOf = (
		read: Pick<Read, 'start' | 'end' | 'now'>,
		tz: string
	): { first: CalendarDay; last: CalendarDay; clampedTo?: Date } | null => {
		const span = daySpan(read.start, read.end, tz)
		const today = todayIn(read.now, tz)
		if (!span || span.first > today) {
			return null
		}
		const last = Math.min(span.last, today)
		// Days past `aggregateDays` are gone, rows and markers both: said, rather than read as zeros.
		const kept = settings.aggregateDays === null ? null : rawFloorDay(today, settings.aggregateDays)
		return kept !== null && span.first < kept
			? { first: kept, last, clampedTo: calendarDayStart(kept, tz) }
			: { first: span.first, last }
	}

	/**
	 * Every scope's prune cut, and the markers of the days their parts of the read cover, read in
	 * one statement each for a read of several scopes.
	 */
	const knownStateOf = async (
		read: Read,
		zoned: ReadonlyArray<{ scope: string; tz: string }>
	): Promise<KnownState> => {
		const scopes = zoned.map((each) => each.scope)
		const pruned = await state.prunedBeforeIn(scopes)
		if (read.shape.source === 'raw' && read.shape.total === undefined) {
			return { pruned }
		}
		let from: CalendarDay | undefined
		let to: CalendarDay | undefined
		for (const { tz } of zoned) {
			const days = daysOf(read, tz)
			if (days !== null && days.first <= days.last) {
				const before = addCalendarDays(days.first, -1)
				from = from === undefined ? before : Math.min(from, before)
				to = to === undefined ? days.last : Math.max(to, days.last)
			}
		}
		const today = await todayCounts(read, zoned)
		if (
			from === undefined ||
			to === undefined ||
			scopes.length * (calendarDaysBetween(from, to) + 1) > MAX_KNOWN_MARKERS
		) {
			return { pruned, today }
		}
		const found = new Map<string, DayMarker[]>(scopes.map((scope) => [scope, []]))
		for (const marker of await state.markersIn(scopes, from, to)) {
			found.get(marker.scope)?.push(marker)
		}
		return { pruned, markers: found, today }
	}

	/**
	 * Today's hits of every scope the read reaches today in, by zone: one statement per zone and
	 * share of scopes rather than one count per scope, each bounded as `isBusy` bounds it.
	 */
	const todayCounts = async (
		read: Read,
		zoned: ReadonlyArray<{ scope: string; tz: string }>
	): Promise<Map<string, { start: number; end: number; hits: number }>> => {
		const byZone = new Map<string, string[]>()
		for (const { scope, tz } of zoned) {
			if (daysOf(read, tz)?.last === todayIn(read.now, tz)) {
				byZone.set(tz, [...(byZone.get(tz) ?? []), scope])
			}
		}
		const counts = new Map<string, { start: number; end: number; hits: number }>()
		for (const [tz, scopes] of byZone) {
			const local = localDay(todayIn(read.now, tz), tz)
			const unknown = scopes.filter(
				(scope) => !busyDays.has(busyKey({ scope, day: local.day, tz, start: local.start }))
			)
			const window = { start: local.start, end: local.end }
			for (const [scope, hits] of await store.countEach(
				unknown,
				window,
				settings.snapshotAboveHits
			)) {
				counts.set(scope, { start: local.start.getTime(), end: local.end.getTime(), hits })
			}
		}
		return counts
	}

	const planScope = async (
		read: Read,
		zoned: { scope: string; tz: string; standIn: boolean }
	): Promise<ScopePlan> => {
		const { scope, tz, standIn } = zoned
		const plan: ScopePlan = {
			aggregates: null,
			raw: [],
			missing: 0,
			capped: 0,
			failed: 0,
			standIn,
			dayCount: 0,
		}
		const days = daysOf(read, tz)
		if (days === null) {
			return plan
		}
		const { first, last, clampedTo } = days
		if (clampedTo) {
			plan.clampedTo = clampedTo
		}
		if (first > last) {
			return plan
		}
		plan.dayCount = calendarDaysBetween(first, last) + 1
		const prunedBefore = read.known
			? (read.known.pruned.get(scope) ?? null)
			: await state.prunedBefore(scope)
		const at: ScopeRead = {
			read,
			scope,
			tz,
			plan,
			standIn,
			prunedBefore,
			rawFrom: later(
				prunedBefore ?? undefined,
				rawFloor(read.now, tz, settings.rawDays) ?? undefined
			),
		}
		if (calendarDaysBetween(first, last) < LONG_SPAN_DAYS) {
			return read.shape.source === 'raw' ? planRaw(at) : planDays(at, { first, last })
		}
		// A long range starts where the scope's data does: a day before it holds nothing to read.
		const oldest = await store.oldestHit(scope)
		const oldestDay = oldest === null ? null : calendarDayOf(oldest, tz)
		if (read.shape.source === 'raw') {
			return oldestDay === null
				? plan
				: planRaw(at, oldestDay > first ? calendarDayStart(oldestDay, tz) : undefined)
		}
		const markers =
			read.known?.markers?.get(scope) ??
			(await state.markers(scope, addCalendarDays(first, -1), last))
		const firstMarked = markers.find((marker) => marker.day >= first)?.day
		const dataFrom = Math.min(
			oldestDay ?? Number.POSITIVE_INFINITY,
			firstMarked ?? Number.POSITIVE_INFINITY
		)
		if (dataFrom > last) {
			return plan
		}
		return dataFrom > first
			? planDays(at, {
					first: dataFrom,
					last,
					markers: markers.filter((marker) => marker.day >= addCalendarDays(dataFrom, -1)),
				})
			: planDays(at, { first, last, markers })
	}

	/**
	 * A refused raw window's days one by one, newest first, while the split budget lasts: each day
	 * refused or past the budget adds the window's width to `missing`.
	 */
	const splitDays = async <T>(
		read: Read,
		window: RawWindow,
		readDay: (piece: RawWindow) => Promise<T>
	): Promise<{ pieces: T[]; missing: number }> => {
		const until = settings.clock() + settings.splitBudgetMs
		const width = widthOf(window)
		const pieces: T[] = []
		let missing = 0
		for (const day of [...window.days].reverse()) {
			if (settings.clock() >= until || read.signal?.aborted) {
				missing += width
				continue
			}
			await unlessRefused(
				async () => {
					pieces.push(await readDay(dayOfWindow(window, day)))
				},
				() => {
					missing += width
				}
			)
		}
		return { pieces, missing }
	}

	/**
	 * A raw window's totals, or once refused (too big, out of time) its days' one by one within the
	 * split budget ({@link splitDays}). With aggregate totals it reads none.
	 */
	const settleRaw = async (
		read: Read,
		window: RawWindow,
		totalsRaw: boolean
	): Promise<{ windows: RawWindow[]; missing: number }> => {
		if (!totalsRaw) {
			return { windows: [window], missing: 0 }
		}
		const totals = await unlessRefused<MetricParts | null>(
			async () => window.totals ?? (await rawTotals(read, window)),
			() => null
		)
		if (totals !== null) {
			return { windows: [{ ...window, totals }], missing: 0 }
		}
		for (const target of window.today ?? []) {
			refuseLive(target, read.stall)
		}
		if (window.days.length <= 1) {
			return { windows: [], missing: window.days.length * widthOf(window) }
		}
		const { pieces, missing } = await splitDays(read, window, async (piece) => ({
			...piece,
			totals: await rawTotals(read, piece),
		}))
		return { windows: pieces.reverse(), missing }
	}

	/** A raw side's part of the answer, or nothing and its days missing when it is refused. */
	const orMissing = <T>(
		side: { window: RawWindow; missing: { count: number } },
		work: () => Promise<T>,
		refused: T
	): Promise<T> =>
		unlessRefused(work, () => {
			side.missing.count += side.window.days.length * widthOf(side.window)
			return refused
		})

	const sideTotals = async (read: Read, side: Side): Promise<MetricParts> => {
		if (side.kind === 'raw') {
			return side.window.totals ?? rawTotals(read, side.window)
		}
		if (read.shape.source !== 'aggregates') {
			return zeroParts(read)
		}
		const [row] = await store.readAggregates(
			aggregateRead(read, side.span, { ...read.shape.total, groupBy: 'total' })
		)
		return row?.parts ?? zeroParts(read)
	}

	const sideDays = async (
		read: Read,
		side: Side,
		missing: { count: number }
	): Promise<Array<[CalendarDay, MetricParts]>> => {
		if (side.kind === 'aggregates') {
			if (read.shape.source !== 'aggregates') {
				return []
			}
			const rows = await store.readAggregates(
				aggregateRead(read, side.span, { ...read.shape.total, groupBy: 'day' })
			)
			return rows.flatMap(
				(row): Array<[CalendarDay, MetricParts]> =>
					row.day === undefined ? [] : [[row.day, row.parts]]
			)
		}
		const { window } = side
		const rows = await orMissing(
			{ window, missing },
			() => store.readRaw({ ...rawBase(read, window), buckets: window.days.map((d) => d.start) }),
			[]
		)
		return rows.flatMap((row): Array<[CalendarDay, MetricParts]> => {
			const day = row.bucket === undefined ? undefined : window.days[row.bucket]
			return day ? [[day.day, row.parts]] : []
		})
	}

	const sideHours = async (
		read: Read,
		window: RawWindow,
		at: { tz: string; missing: { count: number } }
	): Promise<Array<[number, MetricParts]>> => {
		const buckets = hourStarts(window.start, window.end, at.tz)
		if (buckets.length === 0) {
			return []
		}
		const rows = await orMissing(
			{ window, missing: at.missing },
			() => store.readRaw({ ...rawBase(read, window), buckets }),
			[]
		)
		return rows.flatMap((row): Array<[number, MetricParts]> => {
			const start = row.bucket === undefined ? undefined : buckets[row.bucket]
			return start ? [[start.getTime(), row.parts]] : []
		})
	}

	const ranking = (
		rows: readonly (RawRow | AggregateRow)[],
		limit: number | undefined
	): SideRanking => ({
		rows: valueRowsOf(rows),
		complete: limit === undefined || rows.length < limit,
	})

	/** A side whose every row is in hand, ranked: offered and filled without reading again. */
	const sideOf = (rows: readonly ValueRow[]): RankedSide => ({
		top: async (limit) => ({
			rows: limit === undefined ? [...rows] : rows.slice(0, limit),
			complete: limit === undefined || rows.length <= limit,
		}),
		fill: async (values) => {
			const wanted = new Set(values)
			return rows.filter((row) => wanted.has(row.value))
		},
	})

	const rawRanked = (read: Read, window: RawWindow): RawRead => ({
		...rawBase(read, window),
		groupBy: read.breakdown,
		order: read.order,
	})

	/** A refused raw window's ranking day by day ({@link splitDays}), each day read whole. */
	const dayPieces = async (
		read: Read,
		window: RawWindow,
		missing: { count: number }
	): Promise<RankedSide[]> => {
		const split = await splitDays(read, window, async (piece) =>
			sideOf(valueRowsOf(await store.readRaw(rawRanked(read, piece))))
		)
		missing.count += split.missing
		return split.pieces
	}

	/**
	 * A raw window's ranking; one day beside other sides is read once, whole, and fills from that.
	 * Refused, its days are missing, or with `split` it is read day by day ({@link dayPieces}).
	 */
	const rawSide = (
		read: Read,
		window: RawWindow,
		at: { missing: { count: number }; alone: boolean; split: boolean }
	): RankedSide => {
		const base = rawRanked(read, window)
		const whole = window.days.length === 1 && !at.alone
		let everyRow: Promise<ValueRow[]> | undefined
		let pieces: RankedSide[] | undefined
		let refused = false
		const readWhole = (): Promise<ValueRow[]> => {
			everyRow ??= store.readRaw(base).then(valueRowsOf)
			return everyRow
		}
		const refuse = <T>(answer: T): T => {
			if (!refused) {
				refused = true
				at.missing.count += window.days.length * widthOf(window)
			}
			return answer
		}
		return {
			top: (limit) =>
				unlessRefused(
					async () =>
						whole
							? sideOf(await readWhole()).top(limit)
							: ranking(
									await store.readRaw({ ...base, ...(limit === undefined ? {} : { limit }) }),
									limit
								),
					async () => {
						if (!at.split || window.days.length <= 1) {
							return refuse({ rows: [], complete: true })
						}
						pieces = await dayPieces(read, window, at.missing)
						const rows = await topAcross(pieces, read.order, limit)
						return { rows, complete: limit === undefined || rows.length < limit }
					}
				),
			async fill(values) {
				if (pieces) {
					return sumByValue((await Promise.all(pieces.map((piece) => piece.fill(values)))).flat())
				}
				if (refused) {
					return []
				}
				return unlessRefused(
					async () =>
						whole
							? sideOf(await readWhole()).fill(values)
							: valueRowsOf(await store.readRaw({ ...base, values })),
					() => refuse([])
				)
			},
		}
	}

	const rankedSide = (
		read: Read,
		side: Side,
		at: { missing: { count: number }; alone: boolean; split: boolean }
	): RankedSide => {
		if (side.kind === 'raw') {
			return rawSide(read, side.window, at)
		}
		const target = read.shape.source === 'aggregates' ? read.shape.breakdown : undefined
		if (!target) {
			return { top: async () => ({ rows: [], complete: true }), fill: async () => [] }
		}
		const base = aggregateRead(read, side.span, { ...target, order: read.order })
		return {
			async top(limit) {
				const rows = await store.readAggregates({
					...base,
					...(limit === undefined ? {} : { limit }),
				})
				return ranking(rows, limit)
			},
			async fill(values) {
				return valueRowsOf(await store.readAggregates({ ...base, values }))
			},
		}
	}

	const rowsOf = async (
		read: Read,
		sides: readonly Side[],
		at: {
			totals: MetricParts
			labelZone: string
			missing: { count: number }
			/** The raw sides were never settled by a totals read: a refused one is read day by day. */
			split: boolean
		}
	): Promise<AnalyticsRow[]> => {
		const { metrics } = read.query
		const { missing, labelZone } = at
		const breakdown = read.breakdown
		if (breakdown !== undefined) {
			const alone = sides.length === 1
			const top = await topAcross(
				sides.map((side) => rankedSide(read, side, { missing, alone, split: at.split })),
				read.order,
				limitOf(read.query)
			)
			return top.map((row) => {
				const dimensions: Partial<Record<DimensionKey, string>> = {}
				dimensions[breakdown] = row.value
				return { dimensions, metrics: partsToMetrics(row.parts, metrics) }
			})
		}
		if (read.series === 'hour') {
			const byHour = new Map<number, MetricParts>()
			const windows = sides.flatMap((side) => (side.kind === 'raw' ? [side.window] : []))
			const perWindow = await mapLimited(windows, CONCURRENCY, (window) =>
				sideHours(read, window, { tz: labelZone, missing })
			)
			for (const [hour, parts] of perWindow.flat()) {
				addInto(byHour, hour, parts)
			}
			return [...byHour]
				.sort(([a], [b]) => a - b)
				.map(([hour, parts]) => ({
					timestamp: new Date(hour).toISOString(),
					metrics: partsToMetrics(parts, metrics),
				}))
		}
		if (read.series === undefined) {
			return [{ metrics: partsToMetrics(at.totals, metrics) }]
		}
		const unit = read.series
		const byDay = new Map<CalendarDay, MetricParts>()
		const fileDay = fileDayWithin(read, labelZone)
		const perSide = await mapLimited(sides, CONCURRENCY, (side) => sideDays(read, side, missing))
		for (const [scopeDay, parts] of perSide.flat()) {
			addInto(byDay, fileDay(scopeDay), parts)
		}
		const days = [...byDay].sort(([a], [b]) => a - b).map(([day, parts]) => ({ day, parts }))
		if (unit === 'day') {
			return days.map(({ day, parts }) => ({
				timestamp: calendarDayStart(day, labelZone).toISOString(),
				metrics: partsToMetrics(parts, metrics),
			}))
		}
		return foldDays(days, unit).buckets.map((bucket) => ({
			timestamp: bucketInstant(bucket.start, labelZone).toISOString(),
			metrics: partsToMetrics(bucket.parts, metrics),
		}))
	}

	/** The first scope a side reads; every scope merged into it reports in the same currency. */
	const scopeOfSide = (side: Side): string =>
		side.kind === 'aggregates' ? side.span.scope : side.window.scope

	/** A scope's reporting currency, asked once per read. */
	const reportingOf = (read: Read, scope: string): Promise<string | undefined> => {
		const known = read.currencies.get(scope)
		if (known) {
			return known
		}
		const asked = options.currency
			? options.currency(scope).catch((): undefined => undefined)
			: Promise.resolve(undefined)
		read.currencies.set(scope, asked)
		return asked
	}

	/**
	 * What scopes read together must share: the reporting currency when the read names the
	 * currencies its revenue adds by it (see `mixedCurrencies`), nothing otherwise.
	 */
	const mergeKeyOf = async (read: Read, scope: string): Promise<string> =>
		read.query.metrics.includes('revenue') &&
		!read.filters.some((filter) => filter.dimension === 'currency')
			? JSON.stringify((await reportingOf(read, scope)) ?? null)
			: ''

	const scopesIn = (part: Pick<AggregateSpan, 'scope' | 'scopes'>): readonly string[] =>
		part.scopes ?? [part.scope]

	/**
	 * Aggregate spans over the same dates, one read for all their scopes: each scope's rows are of
	 * its own local days, so the sum is the sum of reading each alone.
	 */
	const mergeSpans = (
		spans: readonly AggregateSpan[],
		keyOf: (scope: string) => string
	): AggregateSpan[] => {
		const merged = new Map<string, AggregateSpan>()
		for (const span of spans) {
			const key = JSON.stringify([keyOf(span.scope), span.days])
			const held = merged.get(key)
			merged.set(
				key,
				held ? { ...held, scopes: [...scopesIn(held), ...scopesIn(span)] } : { ...span }
			)
		}
		return [...merged.values()]
	}

	/**
	 * Raw windows over the same instants, cut into the same days (scopes of one zone), one read for
	 * all their scopes: visits are cut per scope, so the answer is the sum of reading each alone.
	 */
	const mergeWindows = (
		windows: readonly RawWindow[],
		keyOf: (scope: string) => string
	): RawWindow[] => {
		const merged = new Map<string, RawWindow>()
		for (const window of windows) {
			const key = JSON.stringify([
				keyOf(window.scope),
				window.start.getTime(),
				window.end.getTime(),
				window.from.getTime(),
				window.days.map((day) => [day.day, day.start.getTime(), day.end.getTime()]),
				window.totals === undefined,
			])
			const held = merged.get(key)
			merged.set(
				key,
				held && held.totals === undefined
					? {
							...held,
							scopes: [...scopesIn(held), ...scopesIn(window)],
							today: [...(held.today ?? []), ...(window.today ?? [])],
						}
					: { ...window }
			)
		}
		return [...merged.values()]
	}

	/**
	 * The currencies a side's amounts were sent in, those with revenue alone, under the read's
	 * currency filters only: what the period took, not what its other filters keep.
	 */
	const sideCurrencies = async (
		read: Read,
		side: Side,
		named: readonly AnalyticsFilter[]
	): Promise<string[]> => {
		const rows: ReadonlyArray<RawRow | AggregateRow> =
			side.kind === 'aggregates'
				? await store.readAggregates(
						aggregateRead(read, side.span, { dim: 'currency', groupBy: 'value' })
					)
				: await unlessRefused(
						() =>
							store.readRaw({
								...rawBase(read, side.window),
								filters: named,
								sessions: false,
								groupBy: 'currency',
							}),
						() => []
					)
		return rows.flatMap((row) =>
			row.value !== null &&
			(row.parts.revenue ?? 0) !== 0 &&
			named.every((filter) => filterHolds(row.value ?? '', filter))
				? [row.value]
				: []
		)
	}

	/**
	 * The currencies a read's revenue adds, when more than one: a scope's reporting currency alone,
	 * else (or under a currency filter) each as sent. An `eq` currency filter never mixes.
	 */
	const mixedCurrencies = async (
		read: Read,
		sided: ReadonlyArray<{ side: Side; parts: MetricParts }>
	): Promise<string[]> => {
		const named = read.filters.filter((filter) => filter.dimension === 'currency')
		if (
			!read.query.metrics.includes('revenue') ||
			named.some((filter) => filter.operator === 'eq')
		) {
			return []
		}
		const codes = new Set<string>()
		const unconverted: Side[] = []
		const revenueIn = new Map<string, number>()
		for (const { side, parts } of sided) {
			const reporting = named.length === 0 ? await reportingOf(read, scopeOfSide(side)) : undefined
			if (reporting === undefined) {
				unconverted.push(side)
			} else {
				revenueIn.set(reporting, (revenueIn.get(reporting) ?? 0) + (parts.revenue ?? 0))
			}
		}
		for (const [code, revenue] of revenueIn) {
			if (revenue !== 0) {
				codes.add(code)
			}
		}
		const found = await mapLimited(unconverted, CONCURRENCY, (side) =>
			sideCurrencies(read, side, named)
		)
		for (const code of found.flat()) {
			codes.add(code)
		}
		return [...codes].sort(compareCodePoints)
	}

	/** One part of an answer: its sides, its raw windows settled, and the days it is missing. */
	const sidesOf = async (
		read: Read,
		plans: readonly ScopePlan[],
		totalsRaw: boolean
	): Promise<{ sides: Side[]; missing: { count: number } }> => {
		const missing = { count: plans.reduce((sum, plan) => sum + plan.missing, 0) }
		const spans = plans.flatMap((plan) => (plan.aggregates ? [plan.aggregates] : []))
		const windows = plans.flatMap((plan) => plan.raw)
		const keys = new Map<string, string>()
		for (const scope of new Set([...spans, ...windows].map((part) => part.scope))) {
			keys.set(scope, await mergeKeyOf(read, scope))
		}
		const keyOf = (scope: string): string => keys.get(scope) ?? ''
		const settled = await mapLimited(mergeWindows(windows, keyOf), CONCURRENCY, (window) =>
			settleRaw(read, window, totalsRaw)
		)
		missing.count += settled.reduce((sum, outcome) => sum + outcome.missing, 0)
		const sides: Side[] = [
			...mergeSpans(spans, keyOf).map((span): Side => ({ kind: 'aggregates', span })),
			...settled.flatMap(({ windows }) => windows.map((window): Side => ({ kind: 'raw', window }))),
		]
		return { sides, missing }
	}

	/**
	 * The answer of a read's plans; with `totalsBy`, its totals come from those plans instead (its
	 * filter's own rows) and its rows from its raw hits alone.
	 */
	const answer = async (
		read: Read,
		plans: readonly ScopePlan[],
		{
			labelZone,
			totalsBy,
		}: { labelZone: string; totalsBy?: { read: Read; plans: readonly ScopePlan[] } }
	): Promise<AnalyticsResult> => {
		const { query } = read
		const ofRows = await sidesOf(read, plans, totalsBy === undefined)
		const totalsRead = totalsBy?.read ?? read
		const ofTotals = totalsBy ? await sidesOf(totalsBy.read, totalsBy.plans, true) : ofRows
		const sided = await mapLimited(ofTotals.sides, CONCURRENCY, async (side) => ({
			side,
			parts: await sideTotals(totalsRead, side),
		}))
		const totals = sumParts([zeroParts(totalsRead), ...sided.map(({ parts }) => parts)])
		const rows = await rowsOf(read, ofRows.sides, {
			totals,
			labelZone,
			missing: ofRows.missing,
			split: totalsBy !== undefined,
		})
		const mixed = await mixedCurrencies(totalsRead, sided)
		const every = [...plans, ...(totalsBy?.plans ?? [])]
		const clampedTo = every.reduce<Date | undefined>(
			(at, plan) => later(at, plan.clampedTo),
			undefined
		)
		const endsAt = every.reduce<Date | undefined>((at, plan) => earlier(at, plan.endsAt), undefined)
		const asOf = every.reduce<Date | undefined>((at, plan) => earlier(at, plan.asOf), undefined)
		const dayCount = every.reduce((most, plan) => Math.max(most, plan.dayCount), 0)
		const capped = every.reduce((sum, plan) => sum + plan.capped, 0)
		const failedIn = (list: readonly ScopePlan[]): number =>
			list.reduce((sum, plan) => sum + plan.failed, 0)
		const failed = Math.max(failedIn(plans), failedIn(totalsBy?.plans ?? []))
		const missing = Math.max(ofRows.missing.count, ofTotals.missing.count)
		const visitorsAre: VisitorCounting = dayCount <= 1 ? 'distinct' : 'sumOfDaily'
		const withoutVisitor = totals.pageviewsWithoutVisitor ?? 0
		const withoutConsent = totals.pageviewsWithoutConsent ?? 0
		return {
			rows,
			totals: partsToMetrics(totals, query.metrics),
			meta: {
				provider: PROVIDER,
				fetchedAt: settings.now().toISOString(),
				...(clampedTo || endsAt ? { clamped: true } : {}),
				...(clampedTo ? { dataFrom: clampedTo.toISOString() } : {}),
				...(endsAt ? { dataTo: endsAt.toISOString() } : {}),
				...(query.metrics.includes('visitors') ? { visitorsAre } : {}),
				...(missing > 0 ? { partial: { missingDays: missing } } : {}),
				...(capped > 0 ? { capped: { days: capped } } : {}),
				...(failed > 0 ? { failed: { days: failed } } : {}),
				...(asOf ? { asOf: asOf.toISOString() } : {}),
				...(every.some((plan) => plan.standIn) ? { timezoneUnresolved: true } : {}),
				...(mixed.length > 1 ? { mixedCurrencies: mixed } : {}),
				...(withoutVisitor > 0 ? { withoutVisitor: { pageviews: withoutVisitor } } : {}),
				...(withoutConsent > 0 ? { withoutConsent: { pageviews: withoutConsent } } : {}),
			},
		}
	}

	/**
	 * The plans of a raw read's totals from its single filter's own rows, over the days its rows
	 * cover (raw retention may start them late); none for a read whose rows aggregates answer.
	 */
	const planTotals = async (
		read: Read,
		zoned: ReadonlyArray<{ scope: string; tz: string; standIn: boolean }>,
		plans: readonly ScopePlan[]
	): Promise<{ read: Read; plans: ScopePlan[] } | undefined> => {
		if (read.shape.source !== 'raw' || !read.shape.total || read.breakdown === undefined) {
			return undefined
		}
		const totalsRead: Read = {
			...read,
			breakdown: undefined,
			series: undefined,
			shape: { source: 'aggregates', total: read.shape.total },
			axis: read.totalAxis,
		}
		const scoped = zoned.map((each, index) => ({ each, from: plans[index]?.clampedTo }))
		return {
			read: totalsRead,
			plans: await mapLimited(scoped, CONCURRENCY, ({ each, from }) =>
				planScope(
					from === undefined ? totalsRead : { ...totalsRead, start: maxDate(read.start, from) },
					each
				)
			),
		}
	}

	/** Every scope with raw hits or day markers: a scope whose hits are all pruned keeps its days. */
	const everyScope = async (): Promise<string[]> => {
		if (!settings.scoped) {
			return ['']
		}
		const [withHits, withDays] = await Promise.all([store.scopes(), state.scopes()])
		return [...new Set([...withHits, ...withDays])].sort(compareCodePoints)
	}

	const scopesOf = async (query: AnalyticsQuery): Promise<string[]> =>
		settings.scoped && query.scope !== undefined ? [query.scope] : everyScope()

	const breakdownOf = (query: AnalyticsQuery): RawDimension | undefined =>
		query.dimensions?.find(
			(dimension): dimension is RawDimension =>
				isRawDimension(dimension) && (breakdowns === undefined || breakdowns.has(dimension))
		)

	const aggregateClosed = async (
		target: DayTarget,
		options: { attempt?: boolean } = {}
	): Promise<DayRun> => {
		if (!isClosed(localDay(target.day, target.tz), settings.now())) {
			throw new Error(
				`analytics: ${target.day} in ${target.tz} has not closed yet, so it can only be snapshotted`
			)
		}
		await state.ensureMarkers([target])
		return runDay(target, closedStatus(target), options)
	}

	const rebuild = (
		rebuildInput: RebuildDaysInput,
		req?: PayloadRequest
	): Promise<RebuildDaysReport> =>
		rebuildRange(
			{
				store,
				state,
				scopes: everyScope,
				scoped: settings.scoped,
				zoneOf: (scope, asking) => zones.strict(scope, asking),
				probe: probeRun,
				now: settings.now,
			},
			rebuildInput,
			req
		)

	/**
	 * The day a hit at `at` is counted on: the completed day whose recorded window holds it (an older
	 * zone's count keeps its own), else the day whose window in `tz` does (see `windowOf`).
	 */
	const countedDayOf = async (scope: string, at: Date, tz: string): Promise<CountedDay> => {
		const guess = calendarDayOf(at, tz)
		const markers = await state.markers(
			scope,
			addCalendarDays(guess, -2),
			addCalendarDays(guess, 2)
		)
		const prunedBefore = await state.prunedBefore(scope)
		const counted = markers.find(
			(marker) =>
				marker.aggregatedAt !== null && markerStart(marker) <= at && at < markerEnd(marker)
		)
		if (counted) {
			return {
				day: counted.day,
				window: { day: counted.day, start: markerStart(counted), end: markerEnd(counted) },
				marker: counted,
				prunedBefore,
			}
		}
		const byDay = new Map(markers.map((marker) => [marker.day, marker]))
		const scopeDays = { tz, markers: byDay, prunedBefore }
		const own = windowOf(guess, scopeDays)
		const day = at < own.start ? addCalendarDays(guess, -1) : guess
		return {
			day,
			window: day === guess ? own : windowOf(day, scopeDays),
			marker: byDay.get(day),
			prunedBefore,
		}
	}

	const orderStored = async (scope: string, id: string): Promise<void> => {
		const twin = orderTwinOf(id)
		const found = twin === undefined ? null : await store.hitById(twin)
		const tz = found === null ? null : await zones.strict(scope)
		if (found === null || tz === null) {
			return
		}
		const placed = await countedDayOf(scope, found.ts, tz)
		// A count before the prune cut is fixed, and its day may hold tombstones alone: never again.
		const whole =
			!isFixed(placed.marker, placed.prunedBefore) &&
			(placed.prunedBefore === null || placed.window.start >= placed.prunedBefore)
		if (whole && isClosed(placed.window, settings.now())) {
			await state.markDirty(scope, [placed.day])
		}
	}

	const maintenance = createMaintenance({
		store,
		state,
		scopes: everyScope,
		orderStored,
		zoneOf: (scope, req) => zones.strict(scope, req),
		aggregate: (target) => aggregateClosed(target, { attempt: true }),
		snapshot: snapshotDay,
		fits: countFits,
		markEmpty: emptyDays,
		probe: probeRun,
		rebuild,
		rawDays: settings.rawDays,
		aggregateDays: settings.aggregateDays,
		today: { busy: isBusy, maxAgeMs: maxAgeOf },
		now: settings.now,
		clock: settings.clock,
		open: () => !closed,
		owner: newOwner,
		warn,
	})

	let warnedDeferred = false

	const nudger = createNudger({
		now: () => settings.now().getTime(),
		everyMs: NUDGE_EVERY_MS,
		start: () =>
			background('maintenance started by ingest', async () => {
				const beat = settings.runner ? await state.lastBeat(MAINTAIN_TASK_SLUG) : null
				if (settings.runner && !heartbeatStale(beat, settings.maintainIntervalMs, settings.now())) {
					await state.sweep(settings.now())
					return
				}
				// Beside the requests, never a count that would hold them up longer than a statement may.
				const stallMs = (await store.blockingBudgetMs?.()) ?? null
				const report = await maintenance.run({
					budgetMs: NUDGE_BUDGET_MS,
					...(stallMs === null ? {} : { stallMs }),
				})
				if (report.deferred > 0 && !warnedDeferred) {
					warnedDeferred = true
					warn(
						`analytics: maintenance started by ingest left ${report.deferred} count(s) to the analytics-maintain job: each would hold up this process's requests longer than ${stallMs} ms. Run that job in a second process only once the SQLite adapter has wal: true and a busyTimeout of at least 5000, which also moves these counts to worker threads.`
					)
				}
			}),
	})

	/** A realtime read of every scope named: one scope's alone, several by name, none read at all. */
	const liveOf = (
		scopes: readonly string[],
		read: Omit<RealtimeRead, 'scope' | 'scopes'>
	): Promise<RealtimeResult> => {
		const [only] = scopes
		if (only === undefined) {
			return Promise.resolve({
				visitors: 0,
				pageviews: 0,
				minutes: [],
				pages: [],
				sources: [],
			})
		}
		return store.realtime(scopes.length === 1 ? { ...read, scope: only } : { ...read, scopes })
	}

	const idle = async (): Promise<void> => {
		while (running.size > 0) {
			await Promise.allSettled([...running])
		}
	}

	return {
		async read(query, ctx = {}) {
			const filters = readFilters(query)
			const refused = unsupportedFilter({ filters: filterMap }, filters)
			if (refused) {
				throw new UnsupportedFilterError(PROVIDER, refused)
			}
			for (const filter of filters) {
				if (filter.operator === 'matches') {
					checkMatchesPattern(filter.value)
				}
			}
			const breakdown = breakdownOf(query)
			const counted = [...filters.map((filter) => filter.dimension), breakdown]
			if (counted.includes('goal') && counted.includes('item')) {
				throw new InvalidQueryError(
					'analytics: a native read counts goal completions or content items, never both: drop the goal or the item from its filters and breakdown',
					'dimensions'
				)
			}
			const series = seriesOf(query, breakdown)
			const axis = axisOf(filters, breakdown)
			const stall = (await store.blockingBudgetMs?.()) ?? null
			const read: Read = {
				query,
				now: settings.now(),
				start: query.dateRange.start,
				end: new Date(query.dateRange.end.getTime() + 1),
				filters,
				breakdown,
				series,
				shape: readShape({ filters, breakdown, hours: series === 'hour' }),
				axis,
				totalAxis: axisOf(filters, undefined),
				order: orderOf(query, axis),
				visits: countsVisits(query),
				...(ctx.signal ? { signal: ctx.signal } : {}),
				lazyUntil: settings.clock() + settings.lazyBudgetMs,
				stall,
				planned: { ms: 0 },
				runner: {},
				uncounted: { count: 0 },
				emptyLeft: { count: settings.emptyMarkers },
				refresh: [],
				currencies: new Map(),
			}
			const readZones = zones.forRead(query.timezone)
			const scopes = await scopesOf(query)
			const zoned = await Promise.all(
				scopes.map(async (scope) => ({ scope, ...(await readZones.of(scope)) }))
			)
			try {
				if (zoned.length > 1) {
					read.known = await knownStateOf(read, zoned)
				}
				const plans = await mapLimited(zoned, CONCURRENCY, (each) => planScope(read, each))
				const totalsBy = await planTotals(read, zoned, plans)
				const [single] = zoned
				const labelZone =
					query.timezone === undefined && zoned.length === 1 && single ? single.tz : readZones.named
				return await answer(read, plans, { labelZone, ...(totalsBy ? { totalsBy } : {}) })
			} finally {
				if (read.uncounted.count > 0 && !closed) {
					nudger.nudge()
				}
				for (const target of read.refresh) {
					refresh(target, read.stall)
				}
			}
		},

		async realtime(query, ctx = {}) {
			const scope = settings.scoped ? query.scope : ''
			const readZones = zones.forRead(query.timezone)
			const tz = scope === undefined ? readZones.named : (await readZones.of(scope)).tz
			// Every scope by name, so the (scope, ts) index serves an All sites read too.
			const scopes = scope === undefined ? await everyScope() : [scope]
			const start = query.dateRange.start
			const ranked = query.dimensions?.find(
				(dimension): dimension is 'page' | 'source' =>
					dimension === 'page' || dimension === 'source'
			)
			const byMinute = ranked === undefined && query.granularity === 'minute'
			const part: RealtimePart | null =
				ranked === 'page' ? 'pages' : ranked === 'source' ? 'sources' : byMinute ? 'minutes' : null
			const live = await liveOf(scopes, {
				start,
				end: new Date(query.dateRange.end.getTime() + 1),
				from: calendarDayStart(calendarDayOf(start, tz), tz),
				...(query.hostname === undefined ? {} : { hostname: query.hostname }),
				...(query.path === undefined ? {} : { path: query.path }),
				top: limitOf(query) ?? DEFAULT_TOP,
				parts: part === null ? [] : [part],
				timeoutMs: settings.timeoutMs,
				...(ctx.signal ? { signal: ctx.signal } : {}),
			})
			const counts = (count: RealtimeCount): MetricValues => {
				const metrics: MetricValues = {}
				for (const metric of query.metrics) {
					if (metric === 'pageviews' || metric === 'visitors') {
						metrics[metric] = count[metric]
					}
				}
				return metrics
			}
			const rows: AnalyticsRow[] = []
			if (ranked) {
				for (const top of ranked === 'page' ? live.pages : live.sources) {
					const dimensions: Partial<Record<DimensionKey, string>> = {}
					dimensions[ranked] = top.value
					rows.push({ dimensions, metrics: counts(top) })
				}
			} else if (byMinute) {
				const minutes = new Map(live.minutes.map((minute) => [minute.minute.getTime(), minute]))
				const first = start.getTime() - (start.getTime() % 60_000)
				const last = query.dateRange.end.getTime() - (query.dateRange.end.getTime() % 60_000)
				for (let minute = first; minute <= last; minute += 60_000) {
					rows.push({
						timestamp: new Date(minute).toISOString(),
						metrics: counts(minutes.get(minute) ?? { visitors: 0, pageviews: 0 }),
					})
				}
			}
			return {
				rows,
				totals: counts(live),
				meta: { provider: PROVIDER, fetchedAt: settings.now().toISOString() },
			}
		},

		aggregate: (target) => aggregateClosed(target),

		snapshot: snapshotDay,

		maintain: (maintainInput) => track(maintenance.run(maintainInput)),

		rebuild: (rebuildInput) => track(rebuild(rebuildInput)),

		async serverHitDay(scope, at) {
			const tz = await zones.strict(scope)
			if (tz === null) {
				return null
			}
			const now = settings.now()
			const placed = await countedDayOf(scope, at, tz)
			if (settings.rawDays !== null) {
				const floor = rawFloorDay(todayIn(now, tz), settings.rawDays)
				if (placed.day <= floor) {
					throw new AnalyticsTrackError(
						`analytics: a server event at ${at.toISOString()} falls on ${placed.day} in ${tz}, at or before ${floor}, the oldest day whose raw hits are surely kept (retention.rawDays), so it would never be counted`
					)
				}
			}
			return { scope, day: placed.day, tz, closed: isClosed(placed.window, now) }
		},

		async reopen(target) {
			await state.markDirty(target.scope, [target.day])
		},

		orderStored: (scope, id) => track(orderStored(scope, id)),

		async saleAttribution(scope, sale) {
			const [wire, server] = await Promise.all([
				store.hitById(sale.wire),
				store.hitById(sale.server),
			])
			const counted =
				wire !== null && (server === null || twinsWithin(wire.ts, server.ts, settings.twinWindowMs))
					? wire
					: server
			if (counted === null) {
				return {}
			}
			const tz = counted.v === '' ? null : await zones.strict(scope)
			const landing =
				tz === null
					? null
					: await store.latestLanding({
							scope,
							hostname: counted.hostname,
							v: counted.v,
							start: calendarDayStart(calendarDayOf(counted.ts, tz), tz),
							end: counted.ts,
						})
			const acquired = landing ?? counted
			return {
				...attributesOf(acquired, ACQUISITION_ATTRIBUTES),
				...(acquired.channelVersion === undefined
					? {}
					: { channelVersion: acquired.channelVersion }),
				...attributesOf(counted, VISITOR_ATTRIBUTES),
			}
		},

		nudge() {
			if (!closed) {
				nudger.nudge()
			}
		},

		idle,

		async close() {
			closed = true
			await idle()
		},
	}
}
