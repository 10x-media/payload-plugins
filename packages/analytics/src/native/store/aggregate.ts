import { type CalendarDay, calendarDayStart, isCalendarDay } from '../../timeframe/calendar'
import { isValidTimeZone } from '../../timeframe/tz'
import {
	type CapKey,
	type CappableRow,
	type CardinalityCaps,
	compareByRank,
	foldParts,
	OTHER_VALUE,
	resolveCaps,
	UNKNOWN_WHEN_FOLDED,
} from './caps'
import { chunksOf, mapInSlices } from './chunks'
import { aggregateId, ulid } from './ids'
import { addParts, emptyParts, type MetricParts, PART_KEYS, sumParts } from './parts'
import {
	checkOrder,
	checkRowLimit,
	checkScopes,
	compareRanked,
	countedParts,
	countsSomething,
	isSessionDimension,
	partsFrom,
	SESSION_DIMENSIONS,
	type SessionAttribute,
} from './rawRead'
import { DAY_LEASE_MS, dayEnd, dayFinalAfter, dayKey } from './state'
import type {
	AggDim,
	AggregateHooks,
	AggregateRead,
	AggregateResult,
	AggregateRow,
	AggregateRun,
	CompletedDayStatus,
	DayMarker,
	DayWindow,
	FoldRead,
	StateStore,
} from './types'

/**
 * Bumped whenever what a day's rows count changes, so days written under an older version read as
 * stale and are aggregated again.
 */
export const AGGREGATION_VERSION = 4

/** Rows per statement or bulk write: 23 values each, well under SQLite's parameter limit. */
const AGGREGATE_CHUNK = 500

/**
 * Where a kind's values come from: the day, the hit's visit, the hit (`name` on events only),
 * each goal it completed (alone or with a visit attribute), or each item clicked or seen.
 */
type KindSource =
	| { from: 'site' }
	| { from: 'visit'; attribute: SessionAttribute }
	| { from: 'hit'; field: 'path' | 'name' | 'currency' }
	| { from: 'goal'; attribute: SessionAttribute | null }
	| { from: 'item'; page: boolean }

/** One kind of aggregate row: a dimension, or a pair of them. */
export interface AggregateKind {
	/** Its place in {@link AGGREGATE_KINDS}, which is how a day's read names it. */
	index: number
	dim: AggDim
	dim2: AggDim
	/** The cap bounding its values; null for the site row, which has one value. */
	cap: CapKey | null
	source: KindSource
	/** The parts its rows count; every other part is null. */
	counted: ReadonlySet<keyof MetricParts>
}

/** The parts a hit kind's rows count. */
export const HIT_COUNTED = countedParts('hit', true)
/** The parts an item kind's rows count. */
export const ITEM_COUNTED = countedParts('item', true)

const SESSION_KINDS = Object.keys(SESSION_DIMENSIONS)
	.filter(isSessionDimension)
	.map(
		(dim): Omit<AggregateKind, 'index'> => ({
			dim,
			dim2: '',
			cap: dim,
			source: { from: 'visit', attribute: SESSION_DIMENSIONS[dim] },
			counted: HIT_COUNTED,
		})
	)

const goalKind = (
	dim2: AggDim,
	attribute: SessionAttribute | null
): Omit<AggregateKind, 'index'> => ({
	dim: 'goal',
	dim2,
	cap: attribute === null ? 'goal' : 'goalPairs',
	source: { from: 'goal', attribute },
	counted: HIT_COUNTED,
})

const KINDS: ReadonlyArray<Omit<AggregateKind, 'index'>> = [
	{ dim: '', dim2: '', cap: null, source: { from: 'site' }, counted: HIT_COUNTED },
	...SESSION_KINDS,
	{
		dim: 'page',
		dim2: '',
		cap: 'page',
		source: { from: 'hit', field: 'path' },
		counted: HIT_COUNTED,
	},
	{
		dim: 'event',
		dim2: '',
		cap: 'event',
		source: { from: 'hit', field: 'name' },
		counted: HIT_COUNTED,
	},
	{
		dim: 'currency',
		dim2: '',
		cap: 'currency',
		source: { from: 'hit', field: 'currency' },
		counted: HIT_COUNTED,
	},
	goalKind('', null),
	goalKind('channel', 'channel'),
	goalKind('source', 'source'),
	goalKind('utmCampaign', 'utmCampaign'),
	{
		dim: 'item',
		dim2: '',
		cap: 'item',
		source: { from: 'item', page: false },
		counted: ITEM_COUNTED,
	},
	{
		dim: 'item',
		dim2: 'page',
		cap: 'itemPages',
		source: { from: 'item', page: true },
		counted: ITEM_COUNTED,
	},
]

/**
 * Every kind a day is aggregated into, per hostname only: a visitor id is per hostname, so a sum
 * over hostnames is exact and a row across them would only repeat it.
 */
export const AGGREGATE_KINDS: readonly AggregateKind[] = KINDS.map((kind, index) => ({
	...kind,
	index,
}))

/** The kinds a day writes: all of them, the item by page rows only when the install keeps them. */
export const kindsWritten = (itemPages: boolean): AggregateKind[] =>
	AGGREGATE_KINDS.filter((kind) => itemPages || kind.source.from !== 'item' || !kind.source.page)

/** Every `dim` and every `dim2` a kind can have: what bounds a sweep of one day's rows. */
export const KIND_DIMS: readonly AggDim[] = [...new Set(AGGREGATE_KINDS.map((kind) => kind.dim))]
export const KIND_DIMS2: readonly AggDim[] = [...new Set(AGGREGATE_KINDS.map((kind) => kind.dim2))]

export const kindOf = (dim: AggDim, dim2: AggDim): AggregateKind | undefined =>
	AGGREGATE_KINDS.find((kind) => kind.dim === dim && kind.dim2 === dim2)

const refuse = (message: string): never => {
	throw new Error(`analytics: ${message}`)
}

/** A local day of a scope, cut in `tz`. */
export const dayWindow = (scope: string, day: CalendarDay, tz: string): DayWindow => ({
	scope,
	day,
	tz,
	start: calendarDayStart(day, tz),
	end: dayEnd(day, tz),
})

/**
 * A day's window starting at `start` instead, where the day before keeps a count that ended
 * there (see `windowOf`); unchanged without one.
 */
export const startingAt = (window: DayWindow, start: Date | undefined): DayWindow =>
	start === undefined ? window : { ...window, start }

/** How far a window's start may stray from its day's: zones' days start at most 26 hours apart. */
const SEAM_REACH_MS = 2 * 86_400_000

/**
 * Refuses a window that is not its day's in its zone: it must end at the next day's start, and
 * start at its own or within a seam's reach of it, never after its end.
 */
export const checkDayWindow = (window: DayWindow): void => {
	if (typeof window.scope !== 'string') {
		refuse('a day window needs a scope, "" for none')
	}
	if (!isCalendarDay(window.day)) {
		refuse(`${String(window.day)} is not a calendar day (yyyymmdd)`)
	}
	if (!isValidTimeZone(window.tz)) {
		refuse(`"${window.tz}" is not an IANA time zone`)
	}
	const expected = dayWindow(window.scope, window.day, window.tz)
	if (
		!(window.start instanceof Date) ||
		!(window.end instanceof Date) ||
		Number.isNaN(window.start.getTime()) ||
		window.end.getTime() !== expected.end.getTime() ||
		window.start > window.end ||
		Math.abs(window.start.getTime() - expected.start.getTime()) > SEAM_REACH_MS
	) {
		refuse(
			`${window.day} in ${window.tz} runs from ${expected.start.toISOString()} (or a seam near it) to ${expected.end.toISOString()}`
		)
	}
}

/** Where a window starts when that is not its day's own start in its zone, else null. */
export const seamOf = (window: DayWindow): Date | null =>
	window.start.getTime() === calendarDayStart(window.day, window.tz).getTime()
		? null
		: new Date(window.start.getTime())

const COMPLETED: readonly CompletedDayStatus[] = ['partial', 'provisional', 'final']

/** A run checked, with its caps filled in from the defaults. */
export const checkRun = (run: AggregateRun): { caps: CardinalityCaps; itemPages: boolean } => {
	if (typeof run.runId !== 'string' || run.runId === '') {
		refuse('an aggregation run needs the id it holds the day lease under')
	}
	if (!COMPLETED.includes(run.status)) {
		refuse(`a day is completed as ${COMPLETED.join(', ')}, not "${String(run.status)}"`)
	}
	if (run.itemPages !== undefined && typeof run.itemPages !== 'boolean') {
		refuse('itemPages is true or false')
	}
	if (run.timeoutMs !== undefined && (!Number.isInteger(run.timeoutMs) || run.timeoutMs < 1)) {
		refuse(`a count's timeout is a whole number of milliseconds, got ${run.timeoutMs}`)
	}
	return { caps: resolveCaps(run.caps), itemPages: run.itemPages ?? true }
}

/** One row of a day's read, before capping. */
export interface DayRow extends CappableRow {
	kind: AggregateKind
}

/**
 * A row of a day's read, the parts its kind does not count null; a `folded` row (the database's
 * `(other)`) leaves visitors and visits unknown. Undefined for an index no kind has.
 */
export const dayRowOf = (
	row: { kind: number; hostname: string; value: string; value2: string; folded?: boolean },
	part: (key: keyof MetricParts) => number | null
): DayRow | undefined => {
	const kind = AGGREGATE_KINDS[row.kind]
	if (!kind) {
		return undefined
	}
	const parts = partsFrom(kind.counted, part)
	if (row.folded === true) {
		for (const unknown of UNKNOWN_WHEN_FOLDED) {
			parts[unknown] = null
		}
	}
	return { kind, hostname: row.hostname, value: row.value, value2: row.value2, parts }
}

/** Whether a row is an `(other)` row: a capped kind's row with no value of its own. */
const isOtherRow = (row: DayRow): boolean =>
	row.kind.cap !== null && (row.kind.dim2 === '' ? row.value : row.value2) === OTHER_VALUE

/**
 * A day's rows capped per hostname and kind (a pair's per first value, its `(other)` row keeping
 * it), each tail folded with any `(other)` row the database folded: capping twice changes nothing.
 */
export const capDay = (rows: readonly DayRow[], caps: CardinalityCaps): DayRow[] => {
	const groups = new Map<string, DayRow[]>()
	for (const row of rows) {
		const pair = row.kind.dim2 !== ''
		const key = JSON.stringify([row.hostname, row.kind.index, pair ? row.value : null])
		const group = groups.get(key)
		if (group) {
			group.push(row)
		} else {
			groups.set(key, [row])
		}
	}
	const capped: DayRow[] = []
	for (const group of groups.values()) {
		const [first] = group
		if (!first) {
			continue
		}
		const { kind, hostname } = first
		const cap = kind.cap === null ? null : caps[kind.cap]
		if (cap === null) {
			capped.push(...group)
			continue
		}
		const own = group.filter((row) => !isOtherRow(row))
		const ranked = own.length <= cap ? own : [...own].sort(compareByRank)
		const tail = [...ranked.slice(cap), ...group.filter(isOtherRow)]
		capped.push(...ranked.slice(0, cap))
		if (tail.length > 0) {
			capped.push({
				kind,
				hostname,
				value: kind.dim2 === '' ? OTHER_VALUE : first.value,
				value2: OTHER_VALUE,
				parts: foldParts(tail),
			})
		}
	}
	return capped
}

/** An aggregate row as written: its key, the generation that wrote it, and its parts. */
export interface AggregateRecord {
	/** Its key's content id: a rewrite of the day writes the same id again. */
	id: string
	scope: string
	day: CalendarDay
	hostname: string
	dim: AggDim
	value: string
	dim2: AggDim
	value2: string
	gen: string
	parts: MetricParts
}

/** One of a day's rows as a record of generation `gen`. */
export const recordOf = (window: DayWindow, row: DayRow, gen: string): AggregateRecord => {
	const key = {
		scope: window.scope,
		day: window.day,
		hostname: row.hostname,
		dim: row.kind.dim,
		value: row.value,
		dim2: row.kind.dim2,
		value2: row.value2,
	}
	return { id: aggregateId(key), ...key, gen, parts: row.parts }
}

/**
 * Records in id order, so writers lock keys in one order. Ids are base64url, plain ASCII, so the
 * operators' order is code point order, at a quarter of `compareCodePoints`' cost on a busy day.
 */
export const byRecordId = (a: AggregateRecord, b: AggregateRecord): number =>
	a.id < b.id ? -1 : a.id > b.id ? 1 : 0

/** The marker a run completes its day with: its rows' generation, readable from then on. */
export const completedMarker = (
	window: DayWindow,
	run: { status: CompletedDayStatus; gen: string; hits: number; at: Date }
): DayMarker => ({
	scope: window.scope,
	day: window.day,
	tz: window.tz,
	start: seamOf(window),
	status: run.status,
	version: AGGREGATION_VERSION,
	gen: run.gen,
	hits: run.hits,
	leaseOwner: null,
	leaseUntil: null,
	finalAfter: dayFinalAfter(window.day, window.tz),
	aggregatedAt: run.at,
})

/** An aggregate read checked, with the kind it reads and the column it groups by. */
export interface AggregatePlan {
	read: AggregateRead
	kind: AggregateKind
	group: 'day' | 'value' | 'value2' | null
}

const GROUPS: ReadonlyArray<AggregateRead['groupBy']> = ['total', 'day', 'value', 'value2']

/** Refuses days that are not one or more ranges of calendar days, each in order. */
const checkDayRanges = (days: AggregateRead['days'], read: string): void => {
	if (!Array.isArray(days) || days.length === 0) {
		refuse(`${read} needs at least one range of days`)
	}
	for (const [from, to] of days) {
		if (!isCalendarDay(from) || !isCalendarDay(to) || from > to) {
			refuse(`${String(from)} to ${String(to)} is not a range of calendar days`)
		}
	}
}

/** A read checked against the kinds there are; anything malformed throws. */
export const planAggregateRead = (read: AggregateRead): AggregatePlan => {
	const dim2 = read.dim2 ?? ''
	const kind = kindOf(read.dim, dim2)
	if (!kind) {
		return refuse(`no aggregate rows are kept by "${read.dim}" and "${dim2}"`)
	}
	if (!GROUPS.includes(read.groupBy)) {
		refuse(`an aggregate read groups by ${GROUPS.join(', ')}, not "${String(read.groupBy)}"`)
	}
	if (read.groupBy === 'value' && kind.dim === '') {
		refuse('the site row has no values to group by')
	}
	if (read.groupBy === 'value2' && kind.dim2 === '') {
		refuse('only a pair has a second value to group by')
	}
	if (read.values !== undefined && read.groupBy !== 'value' && read.groupBy !== 'value2') {
		refuse('values fill in a breakdown, so they need groupBy value or value2')
	}
	checkDayRanges(read.days, 'an aggregate read')
	checkScopes(read)
	checkOrder(read.order)
	checkRowLimit(read.limit)
	return {
		read,
		kind,
		group: read.groupBy === 'total' ? null : read.groupBy,
	}
}

/** A fold read checked against the kinds there are, with the kind it reads. */
export const planFoldRead = (read: FoldRead): AggregateKind => {
	const kind = kindOf(read.dim, read.dim2 ?? '')
	if (!kind || kind.dim === '') {
		return refuse(`no folded values are kept by "${read.dim}" and "${read.dim2 ?? ''}"`)
	}
	if (typeof read.value !== 'string' || read.value === OTHER_VALUE) {
		refuse('a fold read asks about one value, never the (other) row')
	}
	checkDayRanges(read.days, 'a fold read')
	return kind
}

/**
 * The days a fold read's rows show folded, oldest first. `rows` are the completed days' rows of
 * the value and the `(other)` row: a pair's are its first value's `(other)` rows alone.
 */
export const foldedDaysOf = (
	kind: AggregateKind,
	read: FoldRead,
	rows: ReadonlyArray<{ day: CalendarDay; hostname: string; value: string; value2: string }>
): CalendarDay[] => {
	const days = new Set<CalendarDay>()
	if (kind.dim2 !== '') {
		for (const row of rows) {
			if (row.value === read.value && row.value2 === OTHER_VALUE) {
				days.add(row.day)
			}
		}
		return [...days].sort((a, b) => a - b)
	}
	const seen = new Map<string, { day: CalendarDay; other: boolean; own: boolean }>()
	for (const row of rows) {
		const key = JSON.stringify([row.day, row.hostname])
		const entry = seen.get(key) ?? { day: row.day, other: false, own: false }
		seen.set(key, entry)
		if (row.value === OTHER_VALUE) {
			entry.other = true
		} else if (row.value === read.value) {
			entry.own = true
		}
	}
	for (const entry of seen.values()) {
		if (entry.other && !entry.own) {
			days.add(entry.day)
		}
	}
	return [...days].sort((a, b) => a - b)
}

/** Whether a day lies in any of the ranges, both ends included. */
export const inRanges = (
	day: CalendarDay,
	ranges: ReadonlyArray<readonly [CalendarDay, CalendarDay]>
): boolean => ranges.some(([from, to]) => day >= from && day <= to)

/** The one row a total answers when no completed day holds a row of its kind. */
export const emptyAggregateRow = (plan: AggregatePlan): AggregateRow => ({
	value: null,
	parts: partsFrom(plan.kind.counted, () => 0),
})

/**
 * A read's summed rows as it answers them: a total its one row, anything grouped without its empty
 * rows, ordered and cut.
 */
const answered = (plan: AggregatePlan, rows: readonly AggregateRow[]): AggregateRow[] => {
	if (plan.group === null) {
		return [rows[0] ?? emptyAggregateRow(plan)]
	}
	const ranked = rows
		.filter((row) => countsSomething(row.parts))
		.sort(compareRanked<AggregateRow>(plan.read.order, (row) => row.day ?? 0))
	return plan.read.limit === undefined ? ranked : ranked.slice(0, plan.read.limit)
}

/**
 * The rows a read answers out of the rows it matched, summed in memory: the reference answer every
 * database store must match.
 */
export const answerAggregateRead = (
	plan: AggregatePlan,
	matched: ReadonlyArray<{ day: CalendarDay; value: string; value2: string; parts: MetricParts }>
): AggregateRow[] => {
	const { read } = plan
	const values = read.values === undefined ? null : new Set(read.values)
	const groups = new Map<
		string,
		{ value: string | null; day?: CalendarDay; parts: MetricParts[] }
	>()
	for (const row of matched) {
		const value = plan.group === 'value' ? row.value : plan.group === 'value2' ? row.value2 : null
		if (value === OTHER_VALUE || (values && (value === null || !values.has(value)))) {
			continue
		}
		const day = plan.group === 'day' ? row.day : undefined
		const key = JSON.stringify([value, day ?? null])
		const group = groups.get(key) ?? { value, ...(day === undefined ? {} : { day }), parts: [] }
		groups.set(key, group)
		group.parts.push(row.parts)
	}
	return answered(
		plan,
		[...groups.values()].map(
			({ parts, ...group }): AggregateRow => ({ ...group, parts: sumParts(parts) })
		)
	)
}

/**
 * What reads of one plan over disjoint sets of rows answered (none of them filled in or cut), as
 * one read would: summed by value and day, the empty groups dropped, ordered and cut.
 */
export const mergeAggregateRows = (
	plan: AggregatePlan,
	rows: readonly AggregateRow[]
): AggregateRow[] => {
	const groups = new Map<string, AggregateRow>()
	for (const row of rows) {
		const key = JSON.stringify([row.value, row.day ?? null])
		const held = groups.get(key)
		groups.set(key, held ? { ...held, parts: addParts(held.parts, row.parts) } : row)
	}
	return answered(plan, [...groups.values()])
}

/** The parts of a row summed by a database: null where no row it summed counted the part. */
export const partsOfSums = (part: (key: keyof MetricParts) => number | null): MetricParts => {
	const parts = emptyParts()
	for (const key of PART_KEYS) {
		parts[key] = part(key)
	}
	return parts
}

const dayMarker = async (state: StateStore, window: DayWindow): Promise<DayMarker | undefined> => {
	const [marker] = await state.markers(window.scope, window.day, window.day)
	return marker
}

/** The day's marker while `runId` holds its lease, or undefined when it holds none. */
export const heldMarker = async (
	state: StateStore,
	window: DayWindow,
	runId: string
): Promise<DayMarker | undefined> => {
	const marker = await dayMarker(state, window)
	return marker?.leaseOwner === runId ? marker : undefined
}

/** A run that wrote nothing readers will see. */
export const refusedRun = (hits: number): AggregateResult => ({ completed: false, hits, rows: 0 })

/**
 * Records made per slice of the event loop: a busy day's tens of thousands, each hashed for its id,
 * would otherwise hold the thread for most of a second.
 */
const RECORD_SLICE = 2_000

/** Where a store keeps a day's rows, one generation beside another. */
export interface GenerationWriter {
	/** Every generation the day's rows carry. */
	gens(window: DayWindow): Promise<string[]>
	/** Writes records as rows of their own generation, never over another generation's. */
	write(records: readonly AggregateRecord[]): Promise<void>
	drop(window: DayWindow, gens: readonly string[]): Promise<void>
}

/**
 * Writes a day beside its readable rows, then completes the marker to switch to them. Deletes only
 * dead generations: "all but mine" from a run frozen past its lease would hit its successor's.
 */
export const writeBeside = async (args: {
	state: StateStore
	writer: GenerationWriter
	window: DayWindow
	/** `gen`: the marker's generation when the run began, which must still be the readable one. */
	run: { runId: string; status: CompletedDayStatus; gen: string | null }
	rows: readonly DayRow[]
	hits: number
	now: () => Date
	hooks?: AggregateHooks
}): Promise<AggregateResult> => {
	const { state, writer, window, run, hooks } = args
	// Renewed, never claimed: a lease a dirty mark revoked must stay lost to this run.
	if (!(await state.renew(dayKey(window.scope, window.day), run.runId, DAY_LEASE_MS))) {
		return refusedRun(args.hits)
	}
	const current = await dayMarker(state, window)
	if (current?.leaseOwner !== run.runId || current.gen !== run.gen) {
		return refusedRun(args.hits)
	}
	const leftovers = (await writer.gens(window)).filter((gen) => gen !== run.gen)
	const gen = ulid(args.now())
	const note = { scope: window.scope, day: window.day, gen }
	await state.noteDrop(note)
	const records = (
		await mapInSlices(args.rows, RECORD_SLICE, (row) => recordOf(window, row, gen))
	).sort(byRecordId)
	try {
		let written = 0
		for (const chunk of chunksOf(records, AGGREGATE_CHUNK)) {
			await writer.write(chunk)
			written += chunk.length
			await hooks?.afterChunk?.(written)
		}
		const marker = completedMarker(window, {
			status: run.status,
			gen,
			hits: args.hits,
			at: args.now(),
		})
		if (!(await state.complete(marker, run.runId))) {
			await writer.drop(window, [gen])
			await state.clearDrop(note)
			return refusedRun(args.hits)
		}
	} catch (err) {
		// A completion that failed in transit may still have landed, making its rows the readable ones.
		const readable = await dayMarker(state, window).then(
			(after) => after?.gen === gen,
			() => true
		)
		if (!readable) {
			await writer.drop(window, [gen]).then(
				() => state.clearDrop(note),
				() => undefined
			)
		}
		throw err
	}
	await hooks?.afterComplete?.()
	const dead = [...(run.gen === null ? [] : [run.gen]), ...leftovers]
	try {
		if (dead.length > 0) {
			await writer.drop(window, dead)
		}
		await state.clearDrop(note)
	} catch {
		// The day is complete either way; maintenance finishes the note a failed drop leaves.
	}
	return { completed: true, hits: args.hits, rows: records.length }
}

/** A scope and a day as one key of the map of the generation each completed day reads. */
export const dayGenKey = (scope: string, day: CalendarDay): string => JSON.stringify([scope, day])

const STABLE_ATTEMPTS = 3

/**
 * Reads days' rows between two reads of their generations, again when a day was swapped meanwhile,
 * as a store without transactions has no snapshot to read in.
 */
export const readStable = async <T>(args: {
	gens: () => Promise<ReadonlyMap<string, string>>
	rows: (gens: ReadonlyMap<string, string>) => Promise<T>
}): Promise<T> => {
	for (let attempt = 1; ; attempt++) {
		const before = await args.gens()
		const result = await args.rows(before)
		const after = await args.gens()
		if ([...before].every(([key, gen]) => after.get(key) === gen)) {
			return result
		}
		if (attempt >= STABLE_ATTEMPTS) {
			throw new Error(
				`analytics: the days read were rewritten during each of ${STABLE_ATTEMPTS} reads; read them again`
			)
		}
	}
}
