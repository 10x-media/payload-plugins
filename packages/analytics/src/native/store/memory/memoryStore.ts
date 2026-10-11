import { currentDate } from '../../../core/clock'
import type { AnalyticsFilter } from '../../../core/contract'
import type { GoalCompletion } from '../../../goals/match'
import { isItemClick } from '../../../items/ref'
import {
	type AggregateKind,
	type AggregateRecord,
	answerAggregateRead,
	capDay,
	checkDayWindow,
	checkRun,
	type DayRow,
	dayGenKey,
	foldedDaysOf,
	type GenerationWriter,
	heldMarker,
	inRanges,
	kindsWritten,
	planAggregateRead,
	planFoldRead,
	readStable,
	refusedRun,
	writeBeside,
} from '../aggregate'
import { OTHER_VALUE } from '../caps'
import { checkLimit } from '../chunks'
import { countedHits, distinctHits, holdsVisit, TWIN_WINDOW_MS, tombstoneOf } from '../hits'
import { isOrderHitId } from '../ids'
import type { MetricParts } from '../parts'
import {
	ACQUISITION_ATTRIBUTES,
	checkCountBound,
	compareCodePoints,
	compareRows,
	countsSomething,
	emptyRow,
	fillsNothing,
	filterHolds,
	isRawDimension,
	meetsCondition,
	partsFrom,
	planRawRead,
	type RawAxis,
	type RawDimension,
	type RawPlan,
	rawFilterMap,
	readRealtime,
	readsScope,
	SESSION_DIMENSIONS,
	SESSION_GAP_MS,
	type SessionAttribute,
	VISITOR_ATTRIBUTES,
	visitorKeyOf,
} from '../rawRead'
import { channelGroups, channelTupleOf, tupleKey } from '../reclassify'
import type {
	AggregateRead,
	DayWindow,
	EventStore,
	HitRow,
	RawRead,
	RawRow,
	StateStore,
	TimeWindow,
} from '../types'
import { memoryStateStore } from './memoryState'

type Attributes = Partial<Record<SessionAttribute, string>>

interface Visit {
	sn: number
	/** This hit opens its visit: the visit's first pageview, event or goal. */
	entry: boolean
	bounce: boolean
	sessionMs: number
	attributes: Attributes
}

interface Placed {
	hit: HitRow
	/** Null for a hit with no visitor. */
	visit: Visit | null
}

interface Fact {
	placed: Placed
	/** The goal slug or the item ref a goal or item fact counts. */
	x: string | null
	conversions: number
	revenue: number
	impressions: number
}

const isEngagement = (hit: HitRow): boolean => hit.type === 'engagement'

const byTime = (a: HitRow, b: HitRow): number =>
	a.ts.getTime() - b.ts.getTime() || compareCodePoints(a.id, b.id)

const byEntry = (a: HitRow, b: HitRow): number =>
	Number(isEngagement(a)) - Number(isEngagement(b)) || byTime(a, b)

const attributesOf = (acquisition: HitRow | undefined, first: HitRow | undefined): Attributes => {
	const attributes: Attributes = {}
	const copy = (from: HitRow | undefined, keys: readonly SessionAttribute[]): void => {
		for (const key of keys) {
			const value = from?.[key]
			if (value !== undefined) {
				attributes[key] = value
			}
		}
	}
	copy(acquisition, ACQUISITION_ATTRIBUTES)
	copy(first, VISITOR_ATTRIBUTES)
	return attributes
}

/** One visitor's hits of a day, cut into visits. */
const placeVisitor = (hits: readonly HitRow[]): Placed[] => {
	const visits: HitRow[][] = []
	let latest: number | null = null
	for (const hit of [...hits].sort(byTime)) {
		if (latest === null || hit.ts.getTime() > latest + SESSION_GAP_MS) {
			visits.push([])
		}
		visits.at(-1)?.push(hit)
		const activity = (hit.lastAt ?? hit.ts).getTime()
		latest = latest === null ? activity : Math.max(latest, activity)
	}
	const placed: Placed[] = []
	let landing: HitRow | undefined
	visits.forEach((visit, index) => {
		const ordered = [...visit].sort(byEntry)
		const first = ordered[0]
		if (first && !isEngagement(first) && first.landing) {
			landing = first
		}
		const pageviews = visit.filter((hit) => hit.type === 'pageview').length
		const interactions = visit.filter((hit) => hit.type === 'event' || hit.type === 'goal').length
		const sessionMs = visit.reduce((sum, hit) => sum + (hit.durationMs ?? 0), 0)
		const attributes = attributesOf(landing ?? first, first)
		ordered.forEach((hit, rank) => {
			const entry = rank === 0 && !isEngagement(hit)
			placed.push({
				hit,
				visit: {
					sn: index + 1,
					entry,
					bounce: entry && pageviews === 1 && interactions === 0,
					sessionMs,
					attributes,
				},
			})
		})
	})
	return placed
}

const placeVisits = (hits: readonly HitRow[]): Placed[] => {
	const placed: Placed[] = []
	const visitors = new Map<string, HitRow[]>()
	for (const hit of hits) {
		if (hit.v === '') {
			placed.push({ hit, visit: null })
			continue
		}
		const key = visitorKeyOf(hit)
		const own = visitors.get(key)
		if (own) {
			own.push(hit)
		} else {
			visitors.set(key, [hit])
		}
	}
	for (const own of visitors.values()) {
		placed.push(...placeVisitor(own))
	}
	return placed
}

/** A completion's amount as sent: before it was converted, else as counted. */
const sentOf = (completion: GoalCompletion): number => completion.sent ?? completion.value

/** A hit's revenue as sent: each completion's amount as sent, summed. */
const sentRevenueOf = (hit: HitRow): number =>
	(hit.goals ?? []).reduce((sum, completion) => sum + sentOf(completion), 0)

/**
 * A hit's facts on an axis. A goal completion counts a conversion unless its hit counts none, which
 * is a refund. With `sent`, revenue is counted as each amount was sent.
 */
const factsOf = (placed: Placed, axis: RawAxis, sent = false): Fact[] => {
	const { hit } = placed
	const own = {
		placed,
		conversions: hit.conversions ?? 0,
		revenue: sent ? sentRevenueOf(hit) : (hit.revenue ?? 0),
	}
	if (axis === 'goal') {
		const converts = (hit.conversions ?? 0) > 0 ? 1 : 0
		return (hit.goals ?? []).map((goal) => ({
			placed,
			x: goal.slug,
			conversions: converts,
			revenue: sent ? sentOf(goal) : goal.value,
			impressions: 0,
		}))
	}
	if (axis === 'item') {
		if (isEngagement(hit)) {
			return (hit.impressions ?? []).map((ref) => ({ ...own, x: ref, impressions: 1 }))
		}
		return hit.item ? [{ ...own, x: hit.item, impressions: 0 }] : []
	}
	return [{ ...own, x: null, impressions: 0 }]
}

/**
 * A session attribute as a fact reads it: its visit's, or, for a hit that came with no visitor, the
 * hit's own, which is how a refund stamped with its sale's attribution lands in its sale's rows.
 */
const attributeOf = (placed: Placed, attribute: SessionAttribute): string | undefined =>
	placed.visit
		? placed.visit.attributes[attribute]
		: placed.hit.v === ''
			? placed.hit[attribute]
			: undefined

const dimensionValue = (fact: Fact, key: RawDimension, axis: RawAxis): string | null => {
	const { hit } = fact.placed
	switch (key) {
		case 'page':
			return axis === 'item' && hit.server ? null : hit.path
		case 'event':
			return hit.type === 'event' ? (hit.name ?? null) : null
		case 'goal':
			return axis === 'goal' ? fact.x : null
		case 'item':
			return axis === 'item' ? fact.x : null
		case 'currency':
			return hit.originalCurrency ?? hit.currency ?? null
		default:
			return attributeOf(fact.placed, SESSION_DIMENSIONS[key]) ?? null
	}
}

const dimensionOf = (fact: Fact, filter: AnalyticsFilter, axis: RawAxis): string | null =>
	isRawDimension(filter.dimension) ? dimensionValue(fact, filter.dimension, axis) : null

const holds = (value: string | null, filter: AnalyticsFilter): boolean =>
	value !== null && filterHolds(value, filter)

/** The index of the last bucket starting at or before `at`. */
const bucketOf = (buckets: readonly Date[], at: Date): number => {
	let low = 0
	let high = buckets.length - 1
	while (low < high) {
		const middle = Math.ceil((low + high) / 2)
		const start = buckets[middle]
		if (start !== undefined && at < start) {
			high = middle - 1
		} else {
			low = middle
		}
	}
	return low
}

interface Group {
	sums: Record<Exclude<keyof MetricParts, 'visitors' | 'sessions' | 'sessionMs'>, number>
	visitors: Set<string>
	/** Each counted visit's engaged time, by visit. */
	visits: Map<string, number>
}

const newGroup = (): Group => ({
	sums: {
		pageviews: 0,
		events: 0,
		entries: 0,
		bounces: 0,
		durationMs: 0,
		scrollSum: 0,
		scrollSamples: 0,
		conversions: 0,
		revenue: 0,
		impressions: 0,
		interactions: 0,
	},
	visitors: new Set(),
	visits: new Map(),
})

const add = (group: Group, fact: Fact, axis: RawAxis): void => {
	const { hit, visit } = fact.placed
	const engagement = isEngagement(hit)
	const pageview = hit.type === 'pageview'
	const { sums } = group
	sums.pageviews += pageview ? 1 : 0
	sums.events += hit.type === 'event' || hit.type === 'goal' ? 1 : 0
	sums.entries += visit?.entry ? 1 : 0
	sums.bounces += visit?.bounce ? 1 : 0
	sums.durationMs += hit.durationMs ?? 0
	sums.scrollSum += hit.scrollDepth ?? 0
	sums.scrollSamples += pageview && hit.scrollDepth !== undefined ? 1 : 0
	sums.conversions += fact.conversions
	sums.revenue += fact.revenue
	sums.impressions += fact.impressions
	sums.interactions += isItemClick(hit) ? 1 : 0
	if (hit.v !== '' && (axis === 'item' || !engagement)) {
		group.visitors.add(visitorKeyOf(hit))
	}
	if (visit && !engagement) {
		group.visits.set(JSON.stringify([hit.scope, hit.hostname, hit.v, visit.sn]), visit.sessionMs)
	}
}

const partsOf = (group: Group, counted: ReadonlySet<keyof MetricParts>): MetricParts =>
	partsFrom(counted, (key) => {
		if (key === 'visitors') {
			return group.visitors.size
		}
		if (key === 'sessions') {
			return group.visits.size
		}
		if (key === 'sessionMs') {
			return [...group.visits.values()].reduce((sum, ms) => sum + ms, 0)
		}
		return group.sums[key]
	})

/** Whether a hit lies in a read's window: its scope, its hostname, from `from` up to its end. */
const inReadWindow = (hit: HitRow, read: RawRead, from: Date): boolean =>
	readsScope(read, hit.scope) &&
	(read.hostname === undefined || hit.hostname === read.hostname) &&
	hit.ts >= from &&
	hit.ts < read.end

const inWindow = (hit: HitRow, window: TimeWindow): boolean =>
	hit.scope === window.scope && hit.ts >= window.start && hit.ts < window.end

/**
 * Visitors a planned read keeps (see `VisitorCondition`), by `visitorKeyOf`; undefined keeps all.
 * Tested on hits as counted, so an order's browser record is tested with the server's sale.
 */
export const keptVisitorsIn = (
	hits: readonly HitRow[],
	plan: RawPlan,
	twinWindowMs: number | null = TWIN_WINDOW_MS
): ReadonlySet<string> | undefined => {
	let kept: Set<string> | undefined
	const counted = plan.visitors.length > 0 ? countedHits(hits, twinWindowMs) : []
	for (const condition of plan.visitors) {
		const found = new Set<string>()
		for (const hit of counted) {
			if (
				inReadWindow(hit, plan.read, condition.start) &&
				meetsCondition(hit, condition, plan.read.end)
			) {
				found.add(visitorKeyOf(hit))
			}
		}
		kept = kept === undefined ? found : new Set([...kept].filter((key) => found.has(key)))
	}
	return kept
}

/**
 * A planned read answered over hits in memory, the reference every database store must match:
 * every visitor's visits cut, then the facts filtered. `visitors` cuts only those visitors' visits.
 */
export const answerRawRead = (
	hits: readonly HitRow[],
	plan: RawPlan,
	options: { visitors?: ReadonlySet<string>; twinWindowMs?: number | null } = {}
): RawRow[] => {
	const { read, axis } = plan
	const { visitors, twinWindowMs = TWIN_WINDOW_MS } = options
	if (fillsNothing(plan)) {
		return []
	}
	const window = countedHits(hits, twinWindowMs).filter(
		(hit) =>
			inReadWindow(hit, read, plan.from) &&
			(visitors === undefined || visitors.has(visitorKeyOf(hit)))
	)
	const placed = plan.sessionize ? placeVisits(window) : window.map((hit) => ({ hit, visit: null }))
	const values = read.values === undefined ? null : new Set(read.values)
	const groups = new Map<string, { value: string | null; bucket?: number; group: Group }>()
	for (const fact of placed.flatMap((entry) => factsOf(entry, axis, plan.sent))) {
		if (fact.placed.hit.ts < read.start) {
			continue
		}
		if (!read.filters.every((filter) => holds(dimensionOf(fact, filter, axis), filter))) {
			continue
		}
		if (read.path !== undefined && dimensionValue(fact, 'page', axis) !== read.path) {
			continue
		}
		if (read.item !== undefined && fact.x !== read.item) {
			continue
		}
		const value = plan.group === undefined ? null : dimensionValue(fact, plan.group, axis)
		if (plan.group !== undefined && (value === null || value === '')) {
			continue
		}
		if (values && (value === null || !values.has(value))) {
			continue
		}
		const bucket =
			read.buckets === undefined ? undefined : bucketOf(read.buckets, fact.placed.hit.ts)
		const key = JSON.stringify([value, bucket ?? null])
		const entry = groups.get(key) ?? {
			value,
			...(bucket === undefined ? {} : { bucket }),
			group: newGroup(),
		}
		groups.set(key, entry)
		add(entry.group, fact, axis)
	}
	const rows = [...groups.values()].map(
		({ group, ...key }): RawRow => ({ ...key, parts: partsOf(group, plan.counted) })
	)
	const grouped = plan.group !== undefined || read.buckets !== undefined
	if (!grouped) {
		return [rows[0] ?? emptyRow(plan)]
	}
	const ranked = rows.filter((row) => countsSomething(row.parts)).sort(compareRows(read.order))
	return read.limit === undefined ? ranked : ranked.slice(0, read.limit)
}

const nonEmpty = (value: string | null | undefined): value is string =>
	typeof value === 'string' && value !== ''

const AXES: readonly RawAxis[] = ['hit', 'goal', 'item']

const axisOf = (kind: AggregateKind): RawAxis =>
	kind.source.from === 'goal' ? 'goal' : kind.source.from === 'item' ? 'item' : 'hit'

/** The dimension whose value a kind counting a hit's own field reads. */
const FIELD_DIMENSIONS = {
	path: 'page',
	name: 'event',
	currency: 'currency',
} as const satisfies Record<string, RawDimension>

/** The value and second value a fact counts under in a kind, or null when it has none there. */
const valuesOf = (kind: AggregateKind, fact: Fact): [string, string] | null => {
	const { source } = kind
	switch (source.from) {
		case 'site':
			return ['', '']
		case 'visit': {
			const value = attributeOf(fact.placed, source.attribute)
			return nonEmpty(value) ? [value, ''] : null
		}
		case 'hit': {
			const value = dimensionValue(fact, FIELD_DIMENSIONS[source.field], 'hit')
			return nonEmpty(value) ? [value, ''] : null
		}
		case 'goal': {
			if (!nonEmpty(fact.x)) {
				return null
			}
			if (source.attribute === null) {
				return [fact.x, '']
			}
			const value2 = attributeOf(fact.placed, source.attribute)
			return nonEmpty(value2) ? [fact.x, value2] : null
		}
		case 'item': {
			if (!nonEmpty(fact.x)) {
				return null
			}
			if (!source.page) {
				return [fact.x, '']
			}
			const page = dimensionValue(fact, 'page', 'item')
			return nonEmpty(page) ? [fact.x, page] : null
		}
	}
}

/** Whether a kind counts revenue as sent: the currency rows, each in its own currency. */
const countsSent = (kind: AggregateKind): boolean =>
	kind.source.from === 'hit' && kind.source.field === 'currency'

/**
 * A day's hits counted into every kind, uncapped: the reference every database day read must match.
 * `hits` is every hit the store holds, so an order's two records pair up across days.
 */
export const aggregateHits = (
	hits: readonly HitRow[],
	window: TimeWindow,
	options: { itemPages: boolean; twinWindowMs?: number | null }
): DayRow[] => {
	const { itemPages, twinWindowMs = TWIN_WINDOW_MS } = options
	const day = countedHits(hits, twinWindowMs).filter((hit) => inWindow(hit, window))
	const kinds = kindsWritten(itemPages)
	const byAxis = AXES.map((axis) => ({
		axis,
		kinds: kinds.filter((kind) => axisOf(kind) === axis),
	}))
	const groups = new Map<
		string,
		{ kind: AggregateKind; hostname: string; value: string; value2: string; group: Group }
	>()
	for (const placed of placeVisits(day)) {
		for (const { axis, kinds: ofAxis } of byAxis) {
			const facts = factsOf(placed, axis)
			const sent = factsOf(placed, axis, true)
			for (const kind of ofAxis) {
				for (const fact of countsSent(kind) ? sent : facts) {
					const values = valuesOf(kind, fact)
					if (values === null) {
						continue
					}
					const [value, value2] = values
					const { hostname } = placed.hit
					const key = JSON.stringify([kind.index, hostname, value, value2])
					const entry = groups.get(key) ?? { kind, hostname, value, value2, group: newGroup() }
					groups.set(key, entry)
					add(entry.group, fact, axis)
				}
			}
		}
	}
	return [...groups.values()].map(({ group, ...row }) => ({
		...row,
		parts: partsOf(group, row.kind.counted),
	}))
}

interface MemoryStoreOptions {
	/** Its day markers and leases; a memory state store of its own by default. */
	state?: StateStore
	/** The clock runs are stamped with; the plugin's clock (`currentDate`) by default. */
	now?: () => Date
	/** How far apart an order's records may lie to count as one sale; `TWIN_WINDOW_MS` by default. */
	twinWindowMs?: number | null
}

/** A copy of a stored row, so a caller never holds the store's own. */
const copyOf = (hit: HitRow): HitRow => ({ ...hit, ts: new Date(hit.ts.getTime()) })

/**
 * The hit store in plain memory: what every database store's reads and aggregation are checked
 * against, and the store behind unit tests that need one. Same semantics, no persistence.
 */
export const memoryEventStore = (options: MemoryStoreOptions = {}): EventStore => {
	const { now = currentDate, twinWindowMs = TWIN_WINDOW_MS } = options
	const state = options.state ?? memoryStateStore({ now })
	const rows = new Map<string, HitRow>()
	const aggregates = new Map<string, AggregateRecord>()
	const features = {
		aggregates: true,
		rawAnyRange: true,
		filters: rawFilterMap(['eq', 'contains', 'matches']),
	}
	const readRaw = async (read: RawRead): Promise<RawRow[]> => {
		const plan = planRawRead(read, { id: 'memory', filters: features.filters })
		const hits = [...rows.values()]
		const visitors = keptVisitorsIn(hits, plan, twinWindowMs)
		return answerRawRead(hits, plan, { ...(visitors ? { visitors } : {}), twinWindowMs })
	}
	const ofDay = (record: AggregateRecord, window: Pick<DayWindow, 'scope' | 'day'>): boolean =>
		record.scope === window.scope && record.day === window.day
	/** The generation each completed day of `scopes` in `ranges` reads. */
	const generations = async (
		scopes: readonly string[],
		ranges: AggregateRead['days']
	): Promise<Map<string, string>> => {
		const gens = new Map<string, string>()
		for (const scope of scopes) {
			for (const [from, to] of ranges) {
				for (const marker of await state.markers(scope, from, to)) {
					if (marker.gen !== null) {
						gens.set(dayGenKey(scope, marker.day), marker.gen)
					}
				}
			}
		}
		return gens
	}
	/** One kind's records of the generations `gens` reads, in a read's days and on its hostname. */
	const readable = (
		gens: ReadonlyMap<string, string>,
		kind: AggregateKind,
		read: Pick<AggregateRead, 'days' | 'hostname'>
	): AggregateRecord[] =>
		[...aggregates.values()].filter(
			(record) =>
				gens.get(dayGenKey(record.scope, record.day)) === record.gen &&
				inRanges(record.day, read.days) &&
				record.dim === kind.dim &&
				record.dim2 === kind.dim2 &&
				(read.hostname === undefined || record.hostname === read.hostname)
		)
	const writer: GenerationWriter = {
		async gens(window) {
			return [
				...new Set(
					[...aggregates.values()].filter((record) => ofDay(record, window)).map((r) => r.gen)
				),
			]
		},
		async write(records) {
			for (const record of records) {
				aggregates.set(`${record.id}:${record.gen}`, record)
			}
		},
		async drop(window, gens) {
			for (const [key, record] of aggregates) {
				if (ofDay(record, window) && gens.includes(record.gen)) {
					aggregates.delete(key)
				}
			}
		},
	}

	return {
		id: 'memory',
		features,
		async append(hits) {
			let written = 0
			for (const hit of distinctHits(hits).unique) {
				if (!rows.has(hit.id)) {
					rows.set(hit.id, { ...hit })
					written++
				}
			}
			return { written, duplicates: hits.length - written }
		},
		async hitById(id) {
			const hit = rows.get(id)
			return hit ? copyOf(hit) : null
		},
		async latestLanding(probe) {
			let latest: HitRow | undefined
			for (const hit of rows.values()) {
				if (
					hit.scope === probe.scope &&
					hit.hostname === probe.hostname &&
					hit.v === probe.v &&
					hit.type === 'pageview' &&
					hit.landing &&
					hit.ts >= probe.start &&
					hit.ts <= probe.end &&
					(latest === undefined || byTime(latest, hit) < 0)
				) {
					latest = hit
				}
			}
			return latest ? copyOf(latest) : null
		},
		async ordersIn(window) {
			const limit = checkLimit(window.limit)
			const { after } = window
			return [...rows.values()]
				.filter(
					(hit) =>
						isOrderHitId(hit.id) &&
						inWindow(hit, window) &&
						(after === undefined ||
							hit.ts > after.ts ||
							(hit.ts.getTime() === after.ts.getTime() && compareCodePoints(hit.id, after.id) > 0))
				)
				.sort(byTime)
				.slice(0, limit)
				.map((hit) => ({ id: hit.id, ts: new Date(hit.ts.getTime()) }))
		},
		readRaw,
		realtime: (read) => readRealtime(readRaw, read),
		async hasHits(window) {
			for (const hit of rows.values()) {
				if (inWindow(hit, window)) {
					return true
				}
			}
			return false
		},
		async countHits(window, atMost) {
			const most = checkCountBound(atMost) + 1
			let counted = 0
			for (const hit of rows.values()) {
				if (counted >= most) {
					break
				}
				if (inWindow(hit, window)) {
					counted++
				}
			}
			return counted
		},
		async countEach(scopes, window, atMost) {
			const most = checkCountBound(atMost) + 1
			const counts = new Map<string, number>(scopes.map((scope) => [scope, 0]))
			for (const hit of rows.values()) {
				const counted = counts.get(hit.scope)
				if (
					counted !== undefined &&
					counted < most &&
					hit.ts >= window.start &&
					hit.ts < window.end
				) {
					counts.set(hit.scope, counted + 1)
				}
			}
			return counts
		},
		async scopes() {
			return [...new Set([...rows.values()].map((hit) => hit.scope))].sort(compareCodePoints)
		},
		async aggregateDay(window, run) {
			checkDayWindow(window)
			const { caps, itemPages } = checkRun(run)
			const marker = await heldMarker(state, window, run.runId)
			if (!marker) {
				return refusedRun(0)
			}
			const all = [...rows.values()]
			return writeBeside({
				state,
				writer,
				window,
				run: { runId: run.runId, status: run.status, gen: marker.gen },
				rows: capDay(aggregateHits(all, window, { itemPages, twinWindowMs }), caps),
				hits: all.filter((hit) => inWindow(hit, window)).length,
				now,
			})
		},
		async readAggregates(read) {
			const plan = planAggregateRead(read)
			if (fillsNothing(plan)) {
				return []
			}
			const { kind } = plan
			const scopes = [...new Set([...aggregates.values()].map((record) => record.scope))].filter(
				(scope) => readsScope(read, scope)
			)
			return readStable({
				gens: () => generations(scopes, read.days),
				rows: async (gens) =>
					answerAggregateRead(
						plan,
						readable(gens, kind, read).filter(
							(record) =>
								readsScope(read, record.scope) &&
								(read.value === undefined || record.value === read.value)
						)
					),
			})
		},
		async foldedDays(read) {
			const kind = planFoldRead(read)
			return readStable({
				gens: () => generations([read.scope], read.days),
				rows: async (gens) =>
					foldedDaysOf(
						kind,
						read,
						readable(gens, kind, read).filter(
							(record) =>
								record.scope === read.scope &&
								(kind.dim2 === ''
									? record.value === read.value || record.value === OTHER_VALUE
									: record.value === read.value && record.value2 === OTHER_VALUE)
						)
					),
			})
		},
		async hostnames(scope, since) {
			const hosts = new Set<string>()
			for (const record of aggregates.values()) {
				if (
					record.scope === scope &&
					record.day >= since &&
					record.dim === '' &&
					record.dim2 === ''
				) {
					hosts.add(record.hostname)
				}
			}
			return [...hosts].sort(compareCodePoints)
		},
		async oldestHit(scope) {
			let oldest: Date | null = null
			for (const hit of rows.values()) {
				if (hit.scope === scope && (oldest === null || hit.ts < oldest)) {
					oldest = hit.ts
				}
			}
			return oldest === null ? null : new Date(oldest.getTime())
		},
		async pruneHits(chunk) {
			const limit = checkLimit(chunk.limit)
			let pruned = 0
			for (const [id, hit] of rows) {
				if (
					pruned >= limit ||
					hit.scope !== chunk.scope ||
					hit.ts >= chunk.before ||
					(chunk.from !== undefined && hit.ts < chunk.from)
				) {
					continue
				}
				if (!isOrderHitId(id)) {
					rows.delete(id)
					pruned++
				} else if (holdsVisit(hit)) {
					rows.set(id, tombstoneOf(hit))
					pruned++
				}
			}
			return pruned
		},
		async expireOrders(chunk) {
			const limit = checkLimit(chunk.limit)
			let deleted = 0
			for (const [id, hit] of rows) {
				if (
					deleted < limit &&
					isOrderHitId(id) &&
					hit.scope === chunk.scope &&
					hit.ts < chunk.before
				) {
					rows.delete(id)
					deleted++
				}
			}
			return deleted
		},
		async pruneAggregates(chunk) {
			const limit = checkLimit(chunk.limit)
			let deleted = 0
			for (const [key, record] of aggregates) {
				if (deleted < limit && record.scope === chunk.scope && record.day < chunk.beforeDay) {
					aggregates.delete(key)
					deleted++
				}
			}
			return deleted
		},
		async sweepGenerations(day, keep) {
			let deleted = 0
			for (const [key, record] of aggregates) {
				if (ofDay(record, day) && record.gen !== keep) {
					aggregates.delete(key)
					deleted++
				}
			}
			return deleted
		},
		async reclassify(run) {
			const older = (hit: HitRow): boolean =>
				inWindow(hit, run) && hit.channelVersion !== undefined && hit.channelVersion < run.version
			const groups = channelGroups(
				[...rows.values()].filter(older).map(channelTupleOf),
				run.classify
			)
			const channels = new Map<string, string>()
			for (const [channel, tuples] of groups) {
				for (const tuple of tuples) {
					channels.set(tupleKey(tuple), channel)
				}
			}
			let changed = 0
			for (const [id, hit] of rows) {
				const channel = older(hit) ? channels.get(tupleKey(channelTupleOf(hit))) : undefined
				if (channel !== undefined) {
					rows.set(id, { ...hit, channel, channelVersion: run.version })
					changed++
				}
			}
			return changed
		},
	}
}
