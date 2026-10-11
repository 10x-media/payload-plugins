import type { AnalyticsFilter, DimensionKey, FilterOperatorMap } from '../../core/contract'
import type { GoalCompletion } from '../../goals/match'
import type { CalendarDay } from '../../timeframe/calendar'
import type { CardinalityCaps } from './caps'
import type { MetricParts } from './parts'
import type { RawDimension } from './rawRead'

/**
 * What a hit was: an engagement adds time, scroll and items seen to the pageview before it.
 * @beta
 */
export type HitType = 'pageview' | 'event' | 'goal' | 'engagement'

/**
 * One row of `analytics-hits`; an absent field is a null column. An engagement row carries no
 * visitor attributes: its pageview's row has them.
 */
export interface HitRow {
	/**
	 * A ULID of `ts`, or `o` + an order's dedupe key, which refuses a retried order: `ow.` for the
	 * browser's record of a sale, `os.` for the server's, one digest behind both.
	 */
	id: string
	/** `''` on an unscoped install. */
	scope: string
	/** When it happened; an engagement's is its pageview's. */
	ts: Date
	/** An engagement's arrival, where the reading time it reports ends. */
	lastAt?: Date
	type: HitType
	hostname: string
	path: string
	/** The day's visitor id; `''` for a server event that came with no visitor at all. */
	v: string
	/** A pageview opening a visit from outside the site, or with no referrer at all. */
	landing: boolean
	/** Recorded by server code. */
	server: boolean
	name?: string
	/** The other site a landing came from, as a bare host. */
	ref?: string
	source?: string
	channel?: string
	/** The channel taxonomy `channel` was decided under. */
	channelVersion?: number
	/** The ad click id the page's query carried, by name (`gclid`), never its value. */
	clickId?: string
	utmSource?: string
	utmMedium?: string
	utmCampaign?: string
	utmContent?: string
	utmTerm?: string
	country?: string
	region?: string
	city?: string
	language?: string
	device?: string
	browser?: string
	os?: string
	durationMs?: number
	scrollDepth?: number
	value?: number
	originalValue?: number
	/** Goals the hit completed, how many. */
	conversions?: number
	/** What the goals it completed were worth together. */
	revenue?: number
	currency?: string
	originalCurrency?: string
	item?: string
	props?: Record<string, unknown>
	goals?: GoalCompletion[]
	/** On an engagement only: the item refs seen since its previous one. */
	impressions?: string[]
}

/** What one `append` did: rows written, and hits whose id the table already held. */
export interface AppendResult {
	written: number
	duplicates: number
}

/** One scope's hits from `start` up to, not including, `end`. */
export interface TimeWindow {
	scope: string
	start: Date
	end: Date
}

/** The hits of one scope, of several, or of every one, from `start` up to `end`. */
export interface HitWindow {
	scope?: string
	scopes?: readonly string[]
	start: Date
	end: Date
	hostname?: string
}

/** How a raw read ranks its rows before `limit` cuts them; ties go by value, then bucket. */
export interface RawOrder {
	part: keyof MetricParts
	/** Ranks by `part / per` instead; a row with none of `per` comes last either way. */
	per?: keyof MetricParts
	dir: 'asc' | 'desc'
}

/**
 * A read of the raw hits, grouped, ordered and limited by the database. Visit dimensions read the
 * visit a hit belongs to (`rawRead.ts` says how visits are cut); every other dimension the hit.
 */
export interface RawRead {
	/** One scope's hits; absent reads every scope's, or those `scopes` names. */
	scope?: string
	/** Several scopes' hits, `scope` left out: one read for scopes whose days are cut alike. */
	scopes?: readonly string[]
	start: Date
	/** Exclusive. */
	end: Date
	/** Where cutting visits starts (the local day's start), so an earlier visit keeps its entry. */
	from?: Date
	hostname?: string
	path?: string
	/** Only this item's views and clicks. */
	item?: string
	filters: readonly AnalyticsFilter[]
	groupBy?: DimensionKey
	/** Ascending bucket starts, the first at or before `start`. */
	buckets?: readonly Date[]
	/** Count visits; a visit dimension in `groupBy` or `filters` counts them anyway. */
	sessions: boolean
	/** Only these values of `groupBy`, to fill in rows another read ranked. */
	values?: readonly string[]
	order?: RawOrder
	limit?: number
	timeoutMs: number
	/** The read's own: aborted, a statement still waiting for a connection is dropped unrun. */
	signal?: AbortSignal
}

/**
 * A value of `groupBy` (null without one), the index of its bucket, and its parts, a part the read
 * does not count being null. With neither `groupBy` nor `buckets` a read answers exactly one row.
 */
export interface RawRow {
	value: string | null
	bucket?: number
	parts: MetricParts
}

/** What a realtime read answers beside the window's totals. */
export type RealtimePart = 'minutes' | 'pages' | 'sources'

/** Who is on the site in a recent window, normally the last 5 to 60 minutes. */
export interface RealtimeRead {
	/** One scope's hits; absent reads every scope's, or those `scopes` names. */
	scope?: string
	/** Several scopes' hits, `scope` left out: the `(scope, ts)` index serves an All sites read. */
	scopes?: readonly string[]
	start: Date
	end: Date
	/** Where the visits behind `sources` start reading, as `RawRead.from`. */
	from?: Date
	hostname?: string
	path?: string
	/** How many pages and sources to rank by visitors. Default 10. */
	top?: number
	/** The parts it reads beside the totals; every part when absent. */
	parts?: readonly RealtimePart[]
	timeoutMs: number
	/** As `RawRead.signal`. */
	signal?: AbortSignal
}

export interface RealtimeCount {
	/** Visitors with a pageview, an event or a goal in the window. */
	visitors: number
	pageviews: number
}

interface RealtimeMinute extends RealtimeCount {
	/** Only minutes with activity are listed. */
	minute: Date
}

export interface RealtimeTop extends RealtimeCount {
	value: string
}

export interface RealtimeResult extends RealtimeCount {
	minutes: RealtimeMinute[]
	pages: RealtimeTop[]
	sources: RealtimeTop[]
}

/** A local day of one scope, as the instants it runs between in its zone (see `dayWindow`). */
export interface DayWindow {
	scope: string
	day: CalendarDay
	tz: string
	/**
	 * Where counting starts: the day's first instant in `tz`, or where the count of the day before
	 * ended when that one is fixed in another zone (see `windowOf`).
	 */
	start: Date
	/** The next day's first instant in `tz`, which is not always 24 hours on. */
	end: Date
}

/** A dimension aggregate rows are kept by; `''` is the site row's, which has none. */
export type AggDim = RawDimension | ''

/**
 * What a completed day's marker says: `partial` for a snapshot of a day still running,
 * `provisional` for a closed day aggregated once, `final` for its last aggregation.
 */
export type CompletedDayStatus = 'partial' | 'provisional' | 'final'

export interface AggregateRun {
	/**
	 * The owner of the day's lease (`day:<scope>:<day>`), claimed before the call. Nothing the run
	 * writes is read unless it still holds that lease when the day is completed.
	 */
	runId: string
	caps: CardinalityCaps
	status: CompletedDayStatus
	/** Keeps the item by page rows; false when the install counts items without their pages. */
	itemPages?: boolean
	/** Ms its count may run where the database can stop it: set for a count a read started alone. */
	timeoutMs?: number
}

export interface AggregateResult {
	/** False when the run did not hold the day's lease, or lost it: nothing it wrote is read. */
	completed: boolean
	/** Hits the run counted; 0 when it was refused before reading any. */
	hits: number
	/** Rows the day now holds from this run, `(other)` rows included; 0 unless completed. */
	rows: number
}

/** Steps of a day's write where a test fails a run or lets another run in; unset in production. */
export interface AggregateHooks {
	/** The rows are counted and capped; nothing is written yet. */
	beforeWrite?: () => Promise<void>
	/** A chunk of rows of the new generation is written, which no read counts yet. */
	afterChunk?: (written: number) => Promise<void>
	/** The day is completed and its previous generation not dropped yet. */
	afterComplete?: () => Promise<void>
}

/**
 * A sum over completed days' aggregate rows. Visitors add up across hostnames exactly (an id is per
 * hostname), and across days as a sum of daily visitors (an id is per day too).
 */
export interface AggregateRead {
	/** One scope's rows; absent sums every scope's (or `scopes`), each over its own local days. */
	scope?: string
	/** Several scopes' rows, `scope` left out. */
	scopes?: readonly string[]
	/** Ranges of local days, both ends included. */
	days: ReadonlyArray<readonly [CalendarDay, CalendarDay]>
	/** One hostname's rows; absent sums every hostname's. */
	hostname?: string
	dim: AggDim
	/** A pair's second dimension (`goal` by `channel`, `item` by `page`); absent: no pair. */
	dim2?: AggDim
	/** Only the rows of this value of `dim`. */
	value?: string
	/** Only these values of the grouped dimension, to fill in rows another read ranked. */
	values?: readonly string[]
	/** One row, one per day, one per value of `dim`, or one per value of `dim2`. */
	groupBy: 'total' | 'day' | 'value' | 'value2'
	order?: RawOrder
	limit?: number
	/** As `RawRead.signal`. */
	signal?: AbortSignal
}

/**
 * Shaped like a raw read's row, so the two merge directly: the grouped value (null for a total or
 * a day series), the day of a series, and the summed parts. A grouped read leaves `(other)` out.
 */
export interface AggregateRow {
	value: string | null
	day?: CalendarDay
	parts: MetricParts
}

/**
 * Which completed days of one scope folded one value into an `(other)` row: a dimension's value
 * (`dim2` absent), or the second values of a pair's first value (`dim2` set).
 */
export interface FoldRead {
	scope: string
	/** Ranges of local days, both ends included. */
	days: ReadonlyArray<readonly [CalendarDay, CalendarDay]>
	/** One hostname's rows; absent reads every hostname's. */
	hostname?: string
	dim: AggDim
	dim2?: AggDim
	value: string
}

/** What a stored hit's channel is classified from, each null where the hit has none. */
export interface ChannelTuple {
	ref: string | null
	utmSource: string | null
	utmMedium: string | null
	clickId: string | null
}

/** A scope's hits of a window to classify again, the ones decided under an older taxonomy. */
export interface ReclassifyRun extends TimeWindow {
	/** The taxonomy hits are classified under now; only hits of an older one are read. */
	version: number
	/** The channel a tuple classifies into under `version`. */
	classify: (tuple: ChannelTuple) => string
}

/** At most `limit` rows of one scope, older than a cut: one chunk of a prune. */
interface PruneChunk {
	scope: string
	limit: number
}

/** An order record's place in `ordersIn`'s order: its time, then its id. */
export interface OrderKey {
	id: string
	ts: Date
}

/** One visitor's hits on one hostname from `start` through `end`. */
export interface LandingProbe {
	scope: string
	hostname: string
	v: string
	start: Date
	end: Date
}

/**
 * Where hits are kept and read from. `append` never runs inside a transaction the host holds, so a
 * hit lands whether the host's own work commits or not.
 */
export interface EventStore {
	readonly id: string
	readonly features: {
		/** Keeps daily aggregates beside the raw hits. */
		aggregates: boolean
		/** Answers a raw read over any range, rather than the raw retention window alone. */
		rawAnyRange: boolean
		/** The operators `readRaw` filters each dimension with; any other filter is refused. */
		filters: FilterOperatorMap
	}
	/**
	 * How long one statement may hold up this process's thread, in ms: set where statements run on
	 * it to their end (SQLite without its worker threads), null or absent where they never do.
	 */
	blockingBudgetMs?(): Promise<number | null>
	/** Writes every hit whose id is new; an id already stored or repeated in the call is skipped. */
	append(hits: readonly HitRow[]): Promise<AppendResult>
	/** The hit stored under `id`, null when none is: one primary key lookup. */
	hitById(id: string): Promise<HitRow | null>
	/**
	 * The latest landing pageview of one visitor from `start` through `end`, null when there is
	 * none: read backwards off the `(scope, ts)` index from `end`, so it costs the hits in between.
	 */
	latestLanding(probe: LandingProbe): Promise<HitRow | null>
	/**
	 * The ids and times of a scope's order records (`o` ids) in a window, oldest first by time then
	 * id, at most `limit`; with `after`, only those that come after it in that order.
	 */
	ordersIn(window: TimeWindow & { limit: number; after?: OrderKey }): Promise<OrderKey[]>
	/**
	 * Refused with a `ReadTimeoutError` past `timeoutMs`, or on SQLite before reading more than it
	 * allows. An order both sides recorded counts as `countedHit` says, as in a day's aggregation.
	 */
	readRaw(read: RawRead): Promise<RawRow[]>
	realtime(read: RealtimeRead): Promise<RealtimeResult>
	hasHits(window: TimeWindow): Promise<boolean>
	/**
	 * A scope's hits in a window, counted off the `(scope, ts)` index no further than `atMost` + 1:
	 * an answer above `atMost` says only that there are more.
	 */
	countHits(window: TimeWindow, atMost: number): Promise<number>
	/** {@link countHits} of several scopes over one window, in one statement per share of them. */
	countEach(
		scopes: readonly string[],
		window: Omit<TimeWindow, 'scope'>,
		atMost: number
	): Promise<Map<string, number>>
	/** Every scope with hits (`''` for unscoped ones), in code point order. */
	scopes(): Promise<string[]>
	/**
	 * Counts and writes a day beside its old rows, swapped whole at completion on `run.runId`'s
	 * lease; an order both sides recorded counts as `countedHit` says.
	 */
	aggregateDay(window: DayWindow, run: AggregateRun): Promise<AggregateResult>
	/** Reads only completed days: a row counts when its `gen` is its day marker's. */
	readAggregates(read: AggregateRead): Promise<AggregateRow[]>
	/**
	 * The completed days on which some hostname read folded `value` into an `(other)` row: kept no
	 * row of it beside one (a dimension), or kept one for the first value (a pair). Oldest first.
	 */
	foldedDays(read: FoldRead): Promise<CalendarDay[]>
	/** Hostnames a scope's daily totals hold rows of from `since` on, whatever their generation. */
	hostnames(scope: string, since: CalendarDay): Promise<string[]>
	/** The earliest hit a scope holds, an order's tombstone included, or null when it holds none. */
	oldestHit(scope: string): Promise<Date | null>
	/**
	 * Deletes up to `limit` of a scope's hits before `before`, but turns an order's record into its
	 * tombstone (`tombstoneOf`) until `expireOrders` deletes it. Answers how many it changed.
	 */
	pruneHits(chunk: PruneChunk & { before: Date; from?: Date }): Promise<number>
	/** Deletes up to `limit` of a scope's order records from before `before`, answering how many. */
	expireOrders(chunk: PruneChunk & { before: Date }): Promise<number>
	/** Deletes up to `limit` of a scope's aggregate rows of days before `beforeDay`. */
	pruneAggregates(chunk: PruneChunk & { beforeDay: CalendarDay }): Promise<number>
	/**
	 * Deletes a day's rows of every generation but `keep`, the one its marker names (`''` keeps
	 * none): what a run that stopped before clearing them left. The caller holds the day's lease.
	 */
	sweepGenerations(day: { scope: string; day: CalendarDay }, keep: string): Promise<number>
	/**
	 * Classifies a window's hits of an older taxonomy again, a day and a few tuples per statement,
	 * matching each tuple null-safely. Answers how many hits it changed.
	 */
	reclassify(run: ReclassifyRun): Promise<number>
}

/**
 * `open` never counted since it closed, `partial` a snapshot, `provisional` counted once closed,
 * `dirty` to count again, `failed` given up on (whatever count it had kept).
 */
export type DayStatus = 'open' | 'partial' | 'provisional' | 'final' | 'empty' | 'dirty' | 'failed'

/** Where one local day of one scope stands. */
export interface DayMarker {
	scope: string
	day: CalendarDay
	/** The zone the day is cut in; once completed, the zone its aggregates were counted in. */
	tz: string
	/**
	 * Where its count started when that was not the day's own start in `tz`: where the fixed count
	 * of the day before ended, in an older zone. Null: the day's own start.
	 */
	start: Date | null
	status: DayStatus
	/** The aggregation version the day's rows were written with. */
	version: number | null
	/** The generation of the day's readable rows, set by the run that completed it; null before. */
	gen: string | null
	/** How many hits that run counted. */
	hits: number | null
	leaseOwner: string | null
	leaseUntil: Date | null
	/** When the day is aggregated a last time and turns final: its end plus a day and 15 minutes. */
	finalAfter: Date | null
	aggregatedAt: Date | null
	/** Counts maintenance started since the day was last counted; absent: none. */
	failures?: number
}

/** What a completion also asks of the marker it replaces. */
export interface CompleteGuard {
	/** Refused while the day is dirty: a hit landed on it after the run read it. */
	clean?: boolean
}

/** A day to keep a marker for: created `open` when it has none, left alone when it has one. */
export type NewDayMarker = Pick<DayMarker, 'scope' | 'day' | 'tz'>

/**
 * A day a run writes a generation beside the readable one on, noted before it writes any row: a
 * run that stops before clearing the dead generation leaves the note for maintenance to finish.
 */
export interface DropNote {
	scope: string
	day: CalendarDay
	/** The generation the run writes. */
	gen: string
}

/**
 * The engine's coordination rows. Every write runs on the store's own connection, outside any
 * transaction the host holds, and every lease is one conditional write.
 */
export interface StateStore {
	/** A day's salt, created on first use; concurrent creators all get the one the database kept. */
	salt(day: CalendarDay): Promise<string>
	/** A scope's markers from `from` through `to`, oldest first; a day without one is absent. */
	markers(scope: string, from: CalendarDay, to: CalendarDay): Promise<DayMarker[]>
	/** The markers of several scopes from `from` through `to`, by scope and then day. */
	markersIn(scopes: readonly string[], from: CalendarDay, to: CalendarDay): Promise<DayMarker[]>
	ensureMarkers(markers: readonly NewDayMarker[]): Promise<void>
	/**
	 * Won when the lease is free, expired or already `owner`'s (a renewal). A `lease:` row is
	 * created on first claim; a `day:` key needs its marker first.
	 */
	claim(key: string, owner: string, ttlMs: number): Promise<boolean>
	/**
	 * Extends a lease `owner` still holds, expired or not: false once another run took it or a
	 * dirty mark revoked it, where `claim` would take a free lease back.
	 */
	renew(key: string, owner: string, ttlMs: number): Promise<boolean>
	/** Gives a lease back early; false when `owner` no longer holds it. */
	release(key: string, owner: string): Promise<boolean>
	/** Whether someone holds a `lease:` key now: claimed, and neither expired nor released. */
	held(key: string): Promise<boolean>
	/**
	 * Writes a day's new state and clears its lease, refused unless `owner` still holds the lease,
	 * and with `clean` also while the day is marked dirty.
	 */
	complete(marker: DayMarker, owner: string, guard?: CompleteGuard): Promise<boolean>
	/**
	 * Writes a day's status and failures while `owner` keeps its lease; false when it no longer
	 * holds it.
	 */
	attempt(marker: DayMarker, owner: string): Promise<boolean>
	/**
	 * Marks days for another aggregation, forgetting their failures, and revokes their leases: a
	 * running owner can neither complete nor renew one, and the next run may claim it at once.
	 */
	markDirty(scope: string, days: readonly CalendarDay[]): Promise<void>
	/**
	 * Unleased days due for aggregation at `now`, oldest first by day and then scope; with `after`,
	 * only those that come after it in that order.
	 */
	pending(now: Date, limit: number, after?: Pick<DayMarker, 'scope' | 'day'>): Promise<DayMarker[]>
	/** Deletes a scope's day markers before `beforeDay`, once their aggregate rows are gone. */
	dropMarkers(scope: string, beforeDay: CalendarDay): Promise<number>
	/**
	 * The instant before which a scope's raw hits may have been deleted, null while none ever was:
	 * the one definition of what raw hits still cover.
	 */
	prunedBefore(scope: string): Promise<Date | null>
	/** {@link prunedBefore} of several scopes, a scope never pruned absent. */
	prunedBeforeIn(scopes: readonly string[]): Promise<Map<string, Date>>
	/** Records a prune's cut before it deletes, kept only when later than the one recorded. */
	recordPruned(scope: string, before: Date): Promise<void>
	/** The zone of the scope's newest day counted at least once: its last good zone. */
	lastZone(scope: string): Promise<string | null>
	/** Every scope holding a day marker, in code point order. */
	scopes(): Promise<string[]>
	noteDrop(note: DropNote): Promise<void>
	/** At most `limit` notes, of any age. */
	drops(limit: number): Promise<DropNote[]>
	clearDrop(note: DropNote): Promise<void>
	/** Deletes the expired salts, answering how many. */
	sweep(now: Date): Promise<number>
	/** Records that a task finished a run now. */
	beat(task: string): Promise<void>
	lastBeat(task: string): Promise<Date | null>
	/** Where a task's last run stopped short, for the next to start from; null when it finished. */
	cursor(task: string): Promise<string | null>
	/** Records where a task's run stopped short, or with null that it finished. */
	setCursor(task: string, cursor: string | null): Promise<void>
	/** A scope's configuration token, null while none was ever stored. */
	configToken(scope: string): Promise<string | null>
	setConfigToken(scope: string, token: string): Promise<void>
}

/** What sync, warm and cache sweep tasks keep in `analytics-state`: leases, heartbeats, cursors. */
export type TaskStateStore = Pick<
	StateStore,
	'claim' | 'release' | 'held' | 'beat' | 'lastBeat' | 'cursor' | 'setCursor'
>

export interface StateStoreOptions {
	/** Clock leases and heartbeats are stamped with; plugin's clock (`currentDate`) by default. */
	now?: () => Date
	/** The state collection's slug; `analytics-state` by default. */
	slug?: string
}
