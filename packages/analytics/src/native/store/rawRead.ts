import { unsupportedFilter } from '../../core/capabilities'
import type {
	AnalyticsFilter,
	DimensionKey,
	FilterOperator,
	FilterOperatorMap,
} from '../../core/contract'
import { UnsupportedFilterError } from '../../core/sourceErrors'
import { isOneOf } from '../../core/values'
import { MINUTE_MS } from '../../timeframe/tz'
import { emptyParts, type MetricParts, PART_KEYS } from './parts'
import { checkMatchesPattern } from './pattern'
import type {
	HitRow,
	HitWindow,
	RawOrder,
	RawRead,
	RawRow,
	RealtimePart,
	RealtimeRead,
	RealtimeResult,
	RealtimeTop,
} from './types'

/** The hits a raw read takes from `start` on: its scopes, its end and its hostname. */
export const readWindow = (read: RawRead, start: Date): HitWindow => ({
	scope: read.scope,
	scopes: read.scopes,
	start,
	end: read.end,
	hostname: read.hostname,
})

/**
 * A hit more than this long after the latest activity before it (an engagement's lasts until its
 * `lastAt`) opens a new visit of its visitor on that hostname.
 */
export const SESSION_GAP_MINUTES = 30

export const SESSION_GAP_MS = SESSION_GAP_MINUTES * MINUTE_MS

/**
 * What a visit takes from the landing of the visitor's latest landing visit that day, so a visit
 * reopened by an internal link keeps its campaign; before any landing, from its own first hit.
 */
export const ACQUISITION_ATTRIBUTES = [
	'ref',
	'source',
	'channel',
	'clickId',
	'utmSource',
	'utmMedium',
	'utmCampaign',
	'utmContent',
	'utmTerm',
] as const

/** What a visit takes from its own first hit. */
export const VISITOR_ATTRIBUTES = [
	'country',
	'region',
	'city',
	'language',
	'device',
	'browser',
	'os',
] as const

type AcquisitionAttribute = (typeof ACQUISITION_ATTRIBUTES)[number]
type VisitorAttribute = (typeof VISITOR_ATTRIBUTES)[number]
export type SessionAttribute = AcquisitionAttribute | VisitorAttribute

export const SESSION_ATTRIBUTES: readonly SessionAttribute[] = [
	...ACQUISITION_ATTRIBUTES,
	...VISITOR_ATTRIBUTES,
]

/** Whether a visit takes an attribute from its latest landing visit, not its own first hit. */
export const isAcquisition = (attribute: SessionAttribute): boolean =>
	isOneOf(ACQUISITION_ATTRIBUTES, attribute)

/** The dimensions that read a hit's visit rather than the hit; a hit with no visitor has none. */
export const SESSION_DIMENSIONS = {
	referrer: 'ref',
	source: 'source',
	channel: 'channel',
	utmSource: 'utmSource',
	utmMedium: 'utmMedium',
	utmCampaign: 'utmCampaign',
	utmContent: 'utmContent',
	utmTerm: 'utmTerm',
	country: 'country',
	region: 'region',
	city: 'city',
	language: 'language',
	device: 'device',
	browser: 'browser',
	os: 'os',
} as const satisfies Partial<Record<DimensionKey, SessionAttribute>>

export type SessionDimension = keyof typeof SESSION_DIMENSIONS

/** The dimensions that read the hit, or one of its goals or items. */
const HIT_DIMENSIONS = ['page', 'event', 'goal', 'currency', 'item'] as const

type HitDimension = (typeof HIT_DIMENSIONS)[number]
export type RawDimension = SessionDimension | HitDimension

export const isSessionDimension = (dimension: string): dimension is SessionDimension =>
	Object.hasOwn(SESSION_DIMENSIONS, dimension)

export const isRawDimension = (dimension: string): dimension is RawDimension =>
	isSessionDimension(dimension) || isOneOf(HIT_DIMENSIONS, dimension)

const RAW_DIMENSIONS: readonly RawDimension[] = [
	...Object.keys(SESSION_DIMENSIONS).filter(isSessionDimension),
	...HIT_DIMENSIONS,
]

/** A store's `features.filters` when it applies these operators to every dimension it reads. */
export const rawFilterMap = (operators: readonly FilterOperator[]): FilterOperatorMap => {
	const map: FilterOperatorMap = {}
	for (const dimension of RAW_DIMENSIONS) {
		map[dimension] = operators
	}
	return map
}

/** A read that ran out of its time, or on SQLite one refused because it would have. */
export class ReadTimeoutError extends Error {
	readonly timeoutMs: number
	/** Refused before it ran: the database answered the estimate at once, so it is not an outage. */
	readonly refused: boolean

	constructor(
		store: string,
		timeoutMs: number,
		{ cause, refused = false }: { cause?: unknown; refused?: boolean } = {}
	) {
		super(
			`analytics: a raw read on ${store} cannot finish within ${timeoutMs} ms`,
			cause === undefined ? undefined : { cause }
		)
		this.name = 'ReadTimeoutError'
		this.timeoutMs = timeoutMs
		this.refused = refused
	}
}

/**
 * What a read is counted from: every hit, one row per goal completion, or one per item a hit
 * carried (a click) or an engagement saw (a view).
 */
export type RawAxis = 'hit' | 'goal' | 'item'

/** A filter as a hit's own value is tested against it. */
export interface HitFilter {
	dimension: RawDimension
	operator: FilterOperator
	value: string
}

/**
 * Visitors a read keeps before it cuts visits: those with a hit from `start` to the read's end
 * whose own value passes `filter` (any hit, without one). Leaving out the rest changes no number.
 */
export interface VisitorCondition {
	start: Date
	filter?: HitFilter
}

export interface RawPlan {
	read: RawRead
	axis: RawAxis
	/** Visits are cut, because the read counts them or reads a visit dimension. */
	sessionize: boolean
	group: RawDimension | undefined
	/** Where the hits are read from: `read.from` when visits are cut, else `read.start`. */
	from: Date
	/** The parts the read counts; every other part is null. */
	counted: ReadonlySet<keyof MetricParts>
	/**
	 * The read groups or filters by currency, so its revenue is counted as each amount was sent: in
	 * the currency it was sent in, as `currency` is keyed, never converted or zeroed.
	 */
	sent: boolean
	/** Who it keeps before cutting visits; every condition holds. None when it cuts no visits. */
	visitors: VisitorCondition[]
}

const refuse = (message: string): never => {
	throw new Error(`analytics: ${message}`)
}

const isInstant = (value: unknown): value is Date =>
	value instanceof Date && !Number.isNaN(value.getTime())

const isPart = (value: unknown): value is keyof MetricParts => isOneOf(PART_KEYS, value)

const checkBuckets = (read: RawRead): void => {
	const buckets = read.buckets
	if (buckets === undefined) {
		return
	}
	const first = buckets[0]
	if (first === undefined || !buckets.every(isInstant)) {
		refuse('buckets need at least one valid start')
	}
	if (isInstant(first) && first > read.start) {
		refuse('the first bucket has to start at or before the read')
	}
	for (let i = 1; i < buckets.length; i++) {
		const previous = buckets[i - 1]
		const current = buckets[i]
		if (previous && current && current <= previous) {
			refuse('bucket starts have to ascend')
		}
	}
}

/** Refuses a read naming one scope and several, or an empty list of them. */
export const checkScopes = (read: { scope?: string; scopes?: readonly string[] }): void => {
	if (read.scopes === undefined) {
		return
	}
	if (read.scope !== undefined) {
		refuse('a read names one scope or several, never both')
	}
	if (read.scopes.length === 0 || !read.scopes.every((scope) => typeof scope === 'string')) {
		refuse('a read of several scopes names at least one')
	}
}

/** Whether a scope is one a read takes: its scope, one of its scopes, or any without either. */
export const readsScope = (
	read: { scope?: string; scopes?: readonly string[] },
	scope: string
): boolean =>
	read.scopes !== undefined
		? read.scopes.includes(scope)
		: read.scope === undefined || read.scope === scope

/** Refuses a row limit that is no whole number of at least 1. */
export const checkRowLimit = (limit: number | undefined): void => {
	if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
		refuse(`a limit is a whole number of at least 1, got ${limit}`)
	}
}

/** Refuses an order by anything but the parts, or in no direction. */
export const checkOrder = (order: RawOrder | undefined): void => {
	if (order === undefined) {
		return
	}
	if (!isPart(order.part) || (order.per !== undefined && !isPart(order.per))) {
		refuse('a raw read orders by its parts')
	}
	if (order.dir !== 'asc' && order.dir !== 'desc') {
		refuse(`"${String(order.dir)}" is no direction`)
	}
}

const ALWAYS: ReadonlyArray<keyof MetricParts> = [
	'events',
	'visitors',
	'conversions',
	'revenue',
	'interactions',
]
const HIT_PARTS: ReadonlyArray<keyof MetricParts> = [
	'pageviews',
	'durationMs',
	'scrollSum',
	'scrollSamples',
]
const VISIT_PARTS: ReadonlyArray<keyof MetricParts> = [
	'sessions',
	'entries',
	'bounces',
	'sessionMs',
]

/**
 * An item is never viewed as a page, so its rows count views, clicks, the people behind them and
 * what they were worth; a visit is counted only where one is cut.
 */
export const countedParts = (axis: RawAxis, sessionize: boolean): ReadonlySet<keyof MetricParts> =>
	new Set(
		axis === 'item'
			? [...ALWAYS, 'impressions']
			: [...ALWAYS, ...HIT_PARTS, ...(sessionize ? VISIT_PARTS : [])]
	)

/**
 * Who a read cutting visits keeps (see {@link VisitorCondition}): visitors with a hit passing
 * each filter, from `from` for a visit dimension, else from the read's start, and any hit in range.
 */
const visitorConditions = (read: RawRead, from: Date): VisitorCondition[] => {
	const filters: HitFilter[] = [
		...read.filters.flatMap((filter): HitFilter[] =>
			isRawDimension(filter.dimension) ? [{ ...filter, dimension: filter.dimension }] : []
		),
		...(read.path === undefined
			? []
			: [{ dimension: 'page' as const, operator: 'eq' as const, value: read.path }]),
		...(read.item === undefined
			? []
			: [{ dimension: 'item' as const, operator: 'eq' as const, value: read.item }]),
	]
	const conditions = filters.map(
		(filter): VisitorCondition => ({
			start: isSessionDimension(filter.dimension) ? from : read.start,
			filter,
		})
	)
	return from < read.start && !conditions.some((condition) => condition.start >= read.start)
		? [...conditions, { start: read.start }]
		: conditions
}

/**
 * A read checked against what the store applies, and what it takes to answer it. A filter the
 * store does not apply is refused with an `UnsupportedFilterError`; anything malformed throws.
 */
export const planRawRead = (
	read: RawRead,
	store: { id: string; filters: FilterOperatorMap }
): RawPlan => {
	if (!isInstant(read.start) || !isInstant(read.end)) {
		refuse('a raw read needs a valid start and end')
	}
	const from = read.from ?? read.start
	if (!isInstant(from) || from > read.start) {
		refuse('a raw read cuts visits from its start or earlier')
	}
	checkScopes(read)
	const refused = unsupportedFilter(store, read.filters)
	if (refused) {
		throw new UnsupportedFilterError(store.id, refused)
	}
	for (const filter of read.filters) {
		if (filter.operator === 'matches') {
			checkMatchesPattern(filter.value)
		}
	}
	const group = read.groupBy
	if (group !== undefined && !isRawDimension(group)) {
		refuse(`raw reads cannot group by "${group}"`)
	}
	const dimensions = [...read.filters.map((filter) => filter.dimension), ...(group ? [group] : [])]
	const goal = dimensions.includes('goal')
	const item = dimensions.includes('item') || read.item !== undefined
	if (goal && item) {
		refuse('a raw read counts goal completions or items, never both')
	}
	checkBuckets(read)
	checkOrder(read.order)
	if (read.values !== undefined && group === undefined) {
		refuse('values fill in a breakdown, so they need groupBy')
	}
	checkRowLimit(read.limit)
	if (!Number.isInteger(read.timeoutMs) || read.timeoutMs < 1) {
		refuse(`a timeout is a whole number of milliseconds, got ${read.timeoutMs}`)
	}
	const axis: RawAxis = goal ? 'goal' : item ? 'item' : 'hit'
	const sessionize = read.sessions || dimensions.some(isSessionDimension)
	return {
		read,
		axis,
		sessionize,
		group: group !== undefined && isRawDimension(group) ? group : undefined,
		from: sessionize ? from : read.start,
		counted: countedParts(axis, sessionize),
		sent: dimensions.includes('currency'),
		visitors: sessionize ? visitorConditions(read, from) : [],
	}
}

/**
 * The visit attributes a planned read takes, its group's and its filters' where they read a visit,
 * so a store cutting visits carries those alone.
 */
export const visitAttributesOf = (plan: RawPlan): SessionAttribute[] => {
	const dimensions: string[] = [
		...plan.read.filters.map((filter) => filter.dimension),
		...(plan.group === undefined ? [] : [plan.group]),
	]
	const taken = new Set<SessionAttribute>(
		dimensions.filter(isSessionDimension).map((dimension) => SESSION_DIMENSIONS[dimension])
	)
	return SESSION_ATTRIBUTES.filter((attribute) => taken.has(attribute))
}

/** Refuses a bound on a count that is no whole number of at least 0. */
export const checkCountBound = (atMost: number): number => {
	if (!Number.isInteger(atMost) || atMost < 0) {
		refuse(`a count is bounded by a whole number of at least 0, got ${atMost}`)
	}
	return atMost
}

/**
 * A hit's own value of a dimension, as a visitor condition tests it: a goal's or an item's is any
 * of the hit's goals or items, a visit dimension's the hit's own attribute, not its visit's.
 */
const hitValuesOf = (hit: HitRow, dimension: RawDimension): readonly string[] => {
	const one = (value: string | undefined): readonly string[] => (value === undefined ? [] : [value])
	switch (dimension) {
		case 'page':
			return [hit.path]
		case 'event':
			return hit.type === 'event' ? one(hit.name) : []
		case 'currency':
			return one(hit.originalCurrency ?? hit.currency)
		case 'goal':
			return (hit.goals ?? []).map((goal) => goal.slug)
		case 'item':
			return [...one(hit.item), ...(hit.impressions ?? [])]
		default:
			return one(hit[SESSION_DIMENSIONS[dimension]])
	}
}

/** The key one visitor's hits share: a visitor id is per scope and hostname. */
export const visitorKeyOf = (hit: Pick<HitRow, 'scope' | 'hostname' | 'v'>): string =>
	JSON.stringify([hit.scope, hit.hostname, hit.v])

/** Whether a hit meets a visitor condition: in its window, its own value passing its filter. */
export const meetsCondition = (hit: HitRow, condition: VisitorCondition, end: Date): boolean => {
	if (hit.ts < condition.start || hit.ts >= end) {
		return false
	}
	const { filter } = condition
	return (
		filter === undefined ||
		hitValuesOf(hit, filter.dimension).some((value) => filterHolds(value, filter))
	)
}

/** Whether a planned raw or aggregate read can have no rows: an exact fill with no values to fill. */
export const fillsNothing = (plan: { read: Pick<RawRead, 'values'> }): boolean =>
	plan.read.values?.length === 0

/** Whether one value passes a filter as the memory store applies it, case folded but for `eq`. */
export const filterHolds = (value: string, filter: AnalyticsFilter): boolean => {
	if (filter.operator === 'eq') {
		return value === filter.value
	}
	if (filter.operator === 'contains') {
		return value.toLowerCase().includes(filter.value.toLowerCase())
	}
	return new RegExp(filter.value, 'i').test(value)
}

/** Parts out of what a store answered, the counted ones as numbers and the rest null. */
export const partsFrom = (
	counted: ReadonlySet<keyof MetricParts>,
	part: (key: keyof MetricParts) => number | null
): MetricParts => {
	const parts = emptyParts()
	for (const key of PART_KEYS) {
		parts[key] = counted.has(key) ? (part(key) ?? 0) : null
	}
	return parts
}

/** The parts a grouped row must count some of to be kept: a pageview, an event or a view. */
export const KEPT_PARTS = ['pageviews', 'events', 'impressions'] as const satisfies ReadonlyArray<
	keyof MetricParts
>

/** Whether a grouped row, raw or aggregate, is kept: it counted some of {@link KEPT_PARTS}. */
export const countsSomething = (parts: MetricParts): boolean =>
	KEPT_PARTS.reduce((sum, part) => sum + (parts[part] ?? 0), 0) > 0

/** The single row a read without groups answers when nothing matched. */
export const emptyRow = (plan: RawPlan): RawRow => ({
	value: null,
	parts: partsFrom(plan.counted, () => 0),
})

/** Strings in code point order, as SQLite, MongoDB and Postgres' C collation compare them. */
export const compareCodePoints = (a: string, b: string): number => {
	const left = [...a]
	const right = [...b]
	for (let i = 0; i < Math.min(left.length, right.length); i++) {
		const x = left[i]?.codePointAt(0) ?? 0
		const y = right[i]?.codePointAt(0) ?? 0
		if (x !== y) {
			return x - y
		}
	}
	return left.length - right.length
}

/** What a row ranks by: a part, or one part over another, null where there is nothing to divide. */
export const rankOf = (parts: MetricParts, order: RawOrder): number | null => {
	const part = parts[order.part]
	if (order.per === undefined) {
		return part
	}
	const per = parts[order.per]
	return part === null || per === null || per === 0 ? null : part / per
}

/**
 * The order every store answers in: by rank (nothing to rank last), then value (a total's null
 * first), then `position`, a raw row's bucket or an aggregate row's day.
 */
export const compareRanked =
	<R extends { value: string | null; parts: MetricParts }>(
		order: RawOrder | undefined,
		position: (row: R) => number
	) =>
	(a: R, b: R): number => {
		if (order) {
			const x = rankOf(a.parts, order)
			const y = rankOf(b.parts, order)
			if (x !== y) {
				if (x === null) {
					return 1
				}
				if (y === null) {
					return -1
				}
				return order.dir === 'asc' ? x - y : y - x
			}
		}
		if (a.value !== b.value) {
			if (a.value === null) {
				return -1
			}
			if (b.value === null) {
				return 1
			}
			return compareCodePoints(a.value, b.value)
		}
		return position(a) - position(b)
	}

/** {@link compareRanked} for raw rows, ties going by bucket. */
export const compareRows = (order: RawOrder | undefined): ((a: RawRow, b: RawRow) => number) =>
	compareRanked<RawRow>(order, (row) => row.bucket ?? 0)

/** The start of every minute from the one holding `start` up to `end`. */
export const minuteStarts = (start: Date, end: Date): Date[] => {
	const starts: Date[] = []
	for (
		let at = start.getTime() - (((start.getTime() % MINUTE_MS) + MINUTE_MS) % MINUTE_MS);
		at < end.getTime();
		at += MINUTE_MS
	) {
		starts.push(new Date(at))
	}
	return starts.length > 0 ? starts : [new Date(start.getTime())]
}

/** Rows each ranked part of the live view lists when the read names no `top`. */
export const DEFAULT_TOP = 10

const countOf = (row: RawRow | undefined): { visitors: number; pageviews: number } => ({
	visitors: row?.parts.visitors ?? 0,
	pageviews: row?.parts.pageviews ?? 0,
})

const tops = (rows: readonly RawRow[]): RealtimeTop[] =>
	rows.flatMap((row) => (row.value === null ? [] : [{ value: row.value, ...countOf(row) }]))

const REALTIME_PARTS: readonly RealtimePart[] = ['minutes', 'pages', 'sources']

/**
 * The live view out of raw reads on every store; a part that fails fails the whole, never read as
 * no activity. Sources cut visits from `from` for the window's visitors alone (`VisitorCondition`).
 */
export const readRealtime = async (
	readRaw: (read: RawRead) => Promise<RawRow[]>,
	read: RealtimeRead
): Promise<RealtimeResult> => {
	const top = read.top ?? DEFAULT_TOP
	if (!Number.isInteger(top) || top < 1) {
		refuse(`top is a whole number of at least 1, got ${top}`)
	}
	const wanted = new Set(read.parts ?? REALTIME_PARTS)
	for (const part of wanted) {
		if (!REALTIME_PARTS.includes(part)) {
			refuse(`a realtime read answers ${REALTIME_PARTS.join(', ')}, not "${String(part)}"`)
		}
	}
	const base: RawRead = {
		...(read.scopes === undefined ? { scope: read.scope } : { scopes: read.scopes }),
		start: read.start,
		end: read.end,
		hostname: read.hostname,
		path: read.path,
		filters: [],
		sessions: false,
		timeoutMs: read.timeoutMs,
		...(read.signal ? { signal: read.signal } : {}),
	}
	const ranked = { order: { part: 'visitors', dir: 'desc' }, limit: top } as const
	const buckets = minuteStarts(read.start, read.end)
	const when = (part: RealtimePart, raw: RawRead): Promise<RawRow[]> =>
		wanted.has(part) ? readRaw(raw) : Promise.resolve([])
	const [totals, ...parts] = await Promise.allSettled([
		readRaw(base),
		when('minutes', { ...base, buckets }),
		when('pages', { ...base, groupBy: 'page', ...ranked }),
		when('sources', { ...base, from: read.from, groupBy: 'source', ...ranked }),
	])
	if (totals.status === 'rejected') {
		throw totals.reason
	}
	const [minutes, pages, sources] = parts.map((outcome): RawRow[] => {
		if (outcome.status === 'rejected') {
			throw outcome.reason
		}
		return outcome.value
	})
	return {
		...countOf(totals.value[0]),
		minutes: (minutes ?? []).flatMap((row) => {
			const minute = row.bucket === undefined ? undefined : buckets[row.bucket]
			return minute ? [{ minute, ...countOf(row) }] : []
		}),
		pages: tops(pages ?? []),
		sources: tops(sources ?? []),
	}
}
