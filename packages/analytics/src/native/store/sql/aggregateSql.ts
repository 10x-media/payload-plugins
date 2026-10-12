import type { CalendarDay } from '../../../timeframe/calendar'
import {
	type AggregateKind,
	type AggregatePlan,
	type AggregateRecord,
	HIT_COUNTED,
	ITEM_COUNTED,
	KIND_DIMS,
	KIND_DIMS2,
	kindsWritten,
} from '../aggregate'
import { type CardinalityCaps, UNKNOWN_WHEN_FOLDED } from '../caps'
import type { SqlDialect } from '../dialect'
import { generationRowId } from '../ids'
import { type MetricParts, PART_KEYS } from '../parts'
import type { DayWindow, FoldRead, TimeWindow } from '../types'
import {
	contributionsOf,
	dayVisitChain,
	type FactKind,
	fold,
	GOAL,
	goalField,
	hitsCte,
	itemFacts,
	lines,
	rankSql,
	type SqlTarget,
	scopeWhere,
	T,
	t,
	tField,
	visitAttribute,
} from './compile'
import { ident, join, NULL, raw, type SqlFragment, sql, valueList } from './fragment'

/** Where aggregation runs: the hits, aggregates and state tables, as the executor names them. */
export interface AggregateTarget extends SqlTarget {
	aggregates: SqlFragment
	state: SqlFragment
}

/** Each part's aggregates column, as Payload's drizzle adapters name it. */
const AGGREGATE_COLUMNS: { readonly [K in keyof MetricParts]: string } = {
	pageviews: 'pageviews',
	events: 'events',
	visitors: 'visitors',
	sessions: 'sessions',
	entries: 'entries',
	bounces: 'bounces',
	sessionMs: 'session_ms',
	durationMs: 'duration_ms',
	scrollSum: 'scroll_sum',
	scrollSamples: 'scroll_samples',
	conversions: 'conversions',
	revenue: 'revenue',
	impressions: 'impressions',
	interactions: 'interactions',
}

/** The kind a day's read reports its hit count under, in `pageviews`. */
export const HITS_KIND = -1

const EMPTY = raw("''")

/** What a row of a day is keyed by: its kind, its two values and its hostname. */
const ROW_KEYS = ['k', 'v1', 'v2', 'hostname']

/** A row's keys and the visitor, which facts fold by before they fold into the row. */
const VISITOR_KEYS = [...ROW_KEYS, 'v']

const integer = (value: number): SqlFragment => raw(String(Math.trunc(value)))

/** `name("k") AS (VALUES (0), (1))`: the kinds one fact source fans out into. */
const kindsCte = (name: string, kinds: readonly AggregateKind[]): SqlFragment =>
	sql`${ident(name)}("k") AS (VALUES ${join(kinds.map((kind) => sql`(${integer(kind.index)})`))})`

const caseOf = (key: SqlFragment, branches: ReadonlyArray<[number, SqlFragment]>): SqlFragment =>
	sql`CASE ${key} ${join(
		branches.map(([kind, value]) => sql`WHEN ${integer(kind)} THEN ${value}`),
		' '
	)} END`

/** Only kinds whose second value is `''` take a fact without one; a pair needs both. */
const kept = (single: readonly AggregateKind[]): SqlFragment =>
	sql`"v1" IS NOT NULL AND "v1" <> '' AND "v2" IS NOT NULL AND ("v2" <> ''${
		single.length > 0
			? sql` OR "k" IN (${join(single.map((kind) => integer(kind.index)))})`
			: raw('')
	})`

const contributed = (
	fact: FactKind,
	counted: ReadonlySet<keyof MetricParts>,
	dialect: SqlDialect
): SqlFragment[] =>
	[...contributionsOf(fact, counted, dialect)].map(
		([part, value]) => sql`${value} AS ${ident(part)}`
	)

const folded = (
	counted: ReadonlySet<keyof MetricParts>,
	level: 'visit' | 'visitor' | 'row'
): SqlFragment[] => PART_KEYS.filter((part) => counted.has(part)).map((part) => fold(part, level))

/**
 * Every part in its place, a part the source does not count written as a typed NULL: Postgres
 * types a union pair by pair, and two untyped NULLs make text, which no number joins afterwards.
 */
const allParts = (counted: ReadonlySet<keyof MetricParts>, dialect: SqlDialect): SqlFragment[] =>
	PART_KEYS.map((part) =>
		counted.has(part) ? ident(part) : sql`${dialect.cast(NULL, 'real')} AS ${ident(part)}`
	)

const columns = (names: readonly string[]): SqlFragment => join(names.map((name) => ident(name)))

/** What one visit adds to a visit kind: the chain's totals of the visit, on its row of `va`. */
const VISIT_TOTALS = new Map<keyof MetricParts, SqlFragment>([
	['pageviews', t('s_pv')],
	['events', t('s_int')],
	['visitors', sql`CASE WHEN ${t('v_act')} = 1 AND ${tField('v')} <> '' THEN 1 ELSE 0 END`],
	['sessions', sql`CASE WHEN ${t('v_act')} = 1 AND ${t('sn')} IS NOT NULL THEN 1 ELSE 0 END`],
	['entries', t('entry')],
	['bounces', t('bounce')],
	['sessionMs', t('s_ms')],
	['durationMs', t('s_ms')],
	['scrollSum', t('v_ss')],
	['scrollSamples', t('v_sc')],
	['conversions', t('v_conv')],
	['revenue', t('v_rev')],
	['interactions', t('v_int')],
])

/**
 * Site and visit kinds, one fact per visit off its row of `va` (the hits with no visitor make one
 * per hostname), fanned out per kind and folded per visitor, then per row.
 */
const visitKinds = (kinds: readonly AggregateKind[]): SqlFragment[] => {
	const values = kinds.map((kind): [number, SqlFragment] => [
		kind.index,
		kind.source.from === 'visit' ? t(visitAttribute(kind.source.attribute)) : EMPTY,
	])
	const parts = PART_KEYS.filter((part) => HIT_COUNTED.has(part))
	return [
		kindsCte('ks', kinds),
		sql`sf AS (SELECT * FROM (SELECT "ks"."k", ${caseOf(ident('ks', 'k'), values)} AS "v1",
			${lines([...['hostname', 'v'].map((name) => t(name)), ...parts.map((part) => sql`${VISIT_TOTALS.get(part) ?? raw('0')} AS ${ident(part)}`)])}
			FROM va AS ${ident(T)} CROSS JOIN ks WHERE ${t('w')} = 0) AS "f"
		WHERE "v1" IS NOT NULL AND ("v1" <> '' OR "k" = ${integer(kinds[0]?.index ?? 0)}))`,
		sql`sp AS (SELECT ${lines([columns(['k', 'v1', 'hostname', 'v']), ...folded(HIT_COUNTED, 'visitor')])}
		FROM sf GROUP BY "k", "v1", "hostname", "v")`,
		sql`sr AS (SELECT ${lines([columns(['k', 'v1']), sql`'' AS "v2"`, ident('hostname'), ...folded(HIT_COUNTED, 'row')])}
		FROM sp GROUP BY "k", "v1", "hostname")`,
	]
}

/**
 * A hit kind's facts: every hit for pages, events only for events, money hits for currencies, each
 * by the currency it was sent in and counting its revenue as sent.
 */
const hitBranch = (kind: AggregateKind, dialect: SqlDialect): SqlFragment[] => {
	if (kind.source.from !== 'hit') {
		return []
	}
	const field = kind.source.field
	const value =
		field === 'path' ? tField('path') : field === 'name' ? tField('name') : t('sent_currency')
	const where =
		field === 'path'
			? raw('')
			: field === 'name'
				? sql` WHERE ${tField('type')} = 'event'`
				: sql` WHERE ${t('sent_currency')} IS NOT NULL`
	return [
		sql`SELECT ${integer(kind.index)} AS "k", ${value} AS "v1", '' AS "v2",
			${lines([...['hostname', 'v', 'sn'].map((name) => t(name)), ...contributed({ axis: 'hit', sent: field === 'currency' }, HIT_COUNTED, dialect)])}
			FROM a AS ${ident(T)}${where}`,
	]
}

/**
 * Hit, goal and goal pair kinds: one fact per hit or goal completed, folded per visit first. A
 * completion takes its visit's attributes off its own row of `va`.
 */
const hitKinds = (
	target: SqlTarget,
	hits: readonly AggregateKind[],
	goals: readonly AggregateKind[]
): SqlFragment[] => {
	const { dialect } = target
	const goalValues = goals.map((kind): [number, SqlFragment] => [
		kind.index,
		kind.source.from === 'goal' && kind.source.attribute !== null
			? t(visitAttribute(kind.source.attribute))
			: EMPTY,
	])
	const completions = sql`SELECT "kg"."k", ${goalField(dialect, 'slug')} AS "v1", ${caseOf(ident('kg', 'k'), goalValues)} AS "v2",
			${lines([...['hostname', 'v', 'sn'].map((name) => t(name)), ...contributed({ axis: 'goal' }, HIT_COUNTED, dialect)])}
			FROM va AS ${ident(T)} ${dialect.crossJoinJsonArray(tField('goals'), GOAL, 'json')} CROSS JOIN kg
			WHERE ${t('w')} = 1`
	return [
		kindsCte('kg', goals),
		sql`hf AS (SELECT * FROM (${join(
			[...hits.flatMap((kind) => hitBranch(kind, dialect)), completions],
			'\n\t\tUNION ALL\n\t\t'
		)}) AS "f"
		WHERE ${kept([...hits, ...goals].filter((kind) => kind.dim2 === ''))})`,
		sql`hk AS (SELECT ${lines([columns([...VISITOR_KEYS, 'sn']), ...folded(HIT_COUNTED, 'visit')])}
		FROM hf GROUP BY ${columns([...VISITOR_KEYS, 'sn'])})`,
		sql`hp AS (SELECT ${lines([columns(VISITOR_KEYS), ...folded(HIT_COUNTED, 'visitor')])}
		FROM hk GROUP BY ${columns(VISITOR_KEYS)})`,
		sql`hr AS (SELECT ${lines([columns(ROW_KEYS), ...folded(HIT_COUNTED, 'row')])}
		FROM hp GROUP BY ${columns(ROW_KEYS)})`,
	]
}

/** Item kinds: one fact per item clicked or seen, alone and by page (a server hit has no page). */
const itemKinds = (target: SqlTarget, items: readonly AggregateKind[]): SqlFragment[] => {
	const { dialect } = target
	const values = items.map((kind): [number, SqlFragment] => [
		kind.index,
		kind.source.from === 'item' && kind.source.page
			? sql`CASE WHEN ${dialect.isTrue(tField('server'))} THEN NULL ELSE ${tField('path')} END`
			: EMPTY,
	])
	return [
		itemFacts('xi', sql`a AS ${ident(T)}`, dialect),
		kindsCte('kx', items),
		sql`xf AS (SELECT * FROM (SELECT "kx"."k", ${t('x')} AS "v1", ${caseOf(ident('kx', 'k'), values)} AS "v2",
			${lines([...['hostname', 'v'].map((name) => t(name)), ...contributed({ axis: 'item' }, ITEM_COUNTED, dialect)])}
			FROM xi AS ${ident(T)} CROSS JOIN kx) AS "f"
		WHERE ${kept(items.filter((kind) => kind.dim2 === ''))})`,
		sql`xp AS (SELECT ${lines([columns(VISITOR_KEYS), ...folded(ITEM_COUNTED, 'visitor')])}
		FROM xf GROUP BY ${columns(VISITOR_KEYS)})`,
		sql`xr AS (SELECT ${lines([columns(ROW_KEYS), ...folded(ITEM_COUNTED, 'row')])}
		FROM xp GROUP BY ${columns(ROW_KEYS)})`,
	]
}

/**
 * `capDay` in the database: rows ranked within their cap's group, those past the cap folded into
 * its `(other)` row (`o` = 1), so a day answers at most the caps however many values it holds.
 */
const rankAndFold = (
	kinds: readonly AggregateKind[],
	caps: CardinalityCaps,
	dialect: SqlDialect
): { ranked: SqlFragment; select: SqlFragment } => {
	const pairs = kinds.filter((kind) => kind.dim2 !== '').map((kind) => integer(kind.index))
	const group =
		pairs.length === 0 ? EMPTY : sql`CASE WHEN "k" IN (${join(pairs)}) THEN "v1" ELSE '' END`
	const capped = kinds.flatMap((kind): Array<[number, SqlFragment]> => {
		const cap = kind.cap === null ? null : caps[kind.cap]
		return cap === null ? [] : [[kind.index, integer(cap)]]
	})
	const capOf = capped.length === 0 ? dialect.cast(NULL, 'integer') : caseOf(ident('k'), capped)
	const order = join([
		raw('COALESCE("pageviews", "impressions", 0) DESC'),
		raw('COALESCE("events", 0) DESC'),
		sql`${dialect.byCodePoint(ident('v1'))} ASC`,
		sql`${dialect.byCodePoint(ident('v2'))} ASC`,
	])
	const head = columns(ROW_KEYS)
	const parts = columns(PART_KEYS)
	const otherParts = PART_KEYS.map((part) =>
		UNKNOWN_WHEN_FOLDED.includes(part)
			? sql`${dialect.cast(NULL, 'real')} AS ${ident(part)}`
			: sql`SUM(${ident(part)}) AS ${ident(part)}`
	)
	return {
		ranked: sql`rk AS (SELECT ${head}, ${parts},
			ROW_NUMBER() OVER (PARTITION BY "k", "hostname", ${group} ORDER BY ${order}) AS "rn",
			${capOf} AS "cap"
		FROM u)`,
		select: sql`SELECT ${head}, ${parts}, 0 AS "o" FROM rk WHERE "cap" IS NULL OR "rn" <= "cap"
	UNION ALL SELECT "k", ${group} AS "v1", '' AS "v2", "hostname", ${join(otherParts)}, 1 AS "o"
		FROM rk WHERE "rn" > "cap" GROUP BY "k", "hostname", ${group}`,
	}
}

/**
 * A day's count in one statement: every kind's rows per hostname, capped (see {@link rankAndFold}),
 * uncounted parts NULL, and a {@link HITS_KIND} row holding the hits read.
 */
export const compileDayAggregation = (
	window: TimeWindow,
	target: SqlTarget,
	written: { itemPages: boolean; caps: CardinalityCaps }
): SqlFragment => {
	const { itemPages, caps } = written
	const kinds = kindsWritten(itemPages)
	const of = (from: string) => kinds.filter((kind) => kind.source.from === from)
	const visit = [...of('site'), ...of('visit')]
	const ctes = [
		hitsCte(
			window,
			{ sessionize: true, attributes: [], goals: true, impressions: true, sent: true },
			target
		),
		...dayVisitChain(target, window),
		...visitKinds(visit),
		...hitKinds(target, of('hit'), of('goal')),
		...itemKinds(target, of('item')),
	]
	const head = columns(ROW_KEYS)
	const { dialect } = target
	const { ranked, select } = rankAndFold(kinds, caps, dialect)
	const union = sql`u AS (SELECT ${head}, ${join(allParts(HIT_COUNTED, dialect))} FROM sr
		UNION ALL SELECT ${head}, ${join(allParts(HIT_COUNTED, dialect))} FROM hr
		UNION ALL SELECT ${head}, ${join(allParts(ITEM_COUNTED, dialect))} FROM xr)`
	return sql`WITH ${join([...ctes, union, ranked], ',\n\t')}
	${select}
	UNION ALL SELECT ${integer(HITS_KIND)}, '', '', '', COUNT(*), ${join(
		PART_KEYS.slice(1).map(() => NULL)
	)}, 0 FROM a`
}

const AGGREGATE_FIELDS: ReadonlyArray<Exclude<keyof AggregateRecord, 'parts'>> = [
	'id',
	'scope',
	'day',
	'hostname',
	'dim',
	'value',
	'dim2',
	'value2',
	'gen',
]

const recordValues = (record: AggregateRecord): SqlFragment =>
	sql`(${join([
		...AGGREGATE_FIELDS.map((field) =>
			field === 'id' ? sql`${generationRowId(record)}` : sql`${record[field]}`
		),
		...PART_KEYS.map((part) => {
			const value = record.parts[part]
			return value === null ? NULL : sql`${value}`
		}),
	])})`

/**
 * Writes records as rows of their own generation beside the day's readable ones, which no read
 * counts until the day's marker names it. A row already written by the same run is left as it is.
 */
export const compileAggregateInsert = (
	records: readonly AggregateRecord[],
	target: AggregateTarget
): SqlFragment => {
	const parts = PART_KEYS.map((part) => AGGREGATE_COLUMNS[part])
	return sql`INSERT INTO ${target.aggregates} (${columns([...AGGREGATE_FIELDS, ...parts])})
		VALUES ${join(records.map(recordValues))}
		ON CONFLICT (${ident('id')}) DO NOTHING`
}

/** The day's rows of every kind, as the indexes on scope, kind and day find them. */
const dayRows = (window: Pick<DayWindow, 'scope' | 'day'>): SqlFragment =>
	sql`"scope" = ${window.scope} AND "day" = ${window.day}
			AND "dim" IN (${valueList(KIND_DIMS)})
			AND "dim2" IN (${valueList(KIND_DIMS2)})`

/** The generations the day's rows carry. */
export const compileDayGens = (
	window: Pick<DayWindow, 'scope' | 'day'>,
	target: AggregateTarget
): SqlFragment =>
	sql`SELECT DISTINCT "gen" FROM ${target.aggregates}
		WHERE ${dayRows(window)}`

/** Which of a day's rows a delete takes: some generations, or all but one; at most `limit`. */
export type DayRowsDelete = ({ gens: readonly string[] } | { keep: string }) & { limit: number }

/**
 * Deletes up to `limit` of the day's rows: those of the generations `gens` names, or of every
 * generation but `keep`. A statement of its own per share, so no writer waits out the whole day.
 */
export const compileDayRowsDelete = (
	window: Pick<DayWindow, 'scope' | 'day'>,
	which: DayRowsDelete,
	target: AggregateTarget
): SqlFragment => {
	const gens =
		'gens' in which ? sql`"gen" IN (${valueList(which.gens)})` : sql`"gen" <> ${which.keep}`
	return sql`DELETE FROM ${target.aggregates}
		WHERE "id" IN (SELECT "id" FROM ${target.aggregates}
			WHERE ${dayRows(window)}
				AND ${gens}
			LIMIT ${integer(which.limit)})`
}

type DayRanges = ReadonlyArray<readonly [CalendarDay, CalendarDay]>

/** Ranges of days, with the span they cover first where there are several, as an index reads it. */
const dayRanges = (column: SqlFragment, days: DayRanges): SqlFragment => {
	const ranges = join(
		days.map(([from, to]) => sql`(${column} >= ${from} AND ${column} <= ${to})`),
		' OR '
	)
	if (days.length < 2) {
		return ranges
	}
	const from = Math.min(...days.map(([start]) => start))
	const to = Math.max(...days.map(([, end]) => end))
	return sql`${column} >= ${from} AND ${column} <= ${to} AND (${ranges})`
}

/** The completed days' generations of the scopes' ranges, as the `m` a read joins. */
const markersCte = (
	scopes: { scope?: string; scopes?: readonly string[] },
	days: DayRanges,
	target: AggregateTarget
): SqlFragment =>
	sql`m AS (SELECT "scope", "day", "gen" FROM ${target.state}
		WHERE "kind" = 'day' AND "gen" IS NOT NULL${join(
			scopeWhere(scopes, ident('scope')).map((condition) => sql` AND ${condition}`),
			''
		)} AND (${dayRanges(ident('day'), days)}))`

/** A column of the aggregate rows a read takes, aliased `g`. */
const g = (name: string): SqlFragment => ident('g', name)

/** The aggregate rows of the generations the markers `m` name, the only ones a read counts. */
const markedRows = (target: AggregateTarget): SqlFragment =>
	sql`${target.aggregates} AS "g"
			JOIN m ON "m"."scope" = "g"."scope" AND "m"."day" = "g"."day" AND "m"."gen" = "g"."gen"`

/**
 * The rows a fold read decides on: of completed days, the value's and its `(other)` row for a
 * dimension, a pair's first value's `(other)` rows alone.
 */
export const compileFoldRead = (
	read: FoldRead,
	kind: AggregateKind,
	target: AggregateTarget
): SqlFragment => {
	const values =
		kind.dim2 === ''
			? sql`${g('value')} IN (${read.value}, '')`
			: sql`${g('value')} = ${read.value} AND ${g('value2')} = ''`
	return sql`WITH ${markersCte({ scope: read.scope }, read.days, target)}
	SELECT ${g('day')} AS "day", ${g('hostname')} AS "hostname", ${g('value')} AS "value", ${g('value2')} AS "value2"
		FROM ${markedRows(target)}
		WHERE ${g('scope')} = ${read.scope} AND ${g('dim')} = ${kind.dim} AND ${g('dim2')} = ${kind.dim2}
			AND (${dayRanges(g('day'), read.days)})${
				read.hostname === undefined ? raw('') : sql` AND ${g('hostname')} = ${read.hostname}`
			}
			AND ${values}`
}

/** The hostnames a scope's site rows hold from `since` on. */
export const compileHostnames = (
	scope: string,
	since: CalendarDay,
	target: AggregateTarget
): SqlFragment =>
	sql`SELECT DISTINCT "hostname" FROM ${target.aggregates}
		WHERE "scope" = ${scope} AND "dim" = '' AND "dim2" = '' AND "day" >= ${since}`

/**
 * One statement summing the rows of completed days: the markers' generations joined in, so a row
 * written by a run that never completed, or replaced since, is never read, all in one snapshot.
 */
export const compileAggregateRead = (plan: AggregatePlan, target: AggregateTarget): SqlFragment => {
	const { read, kind } = plan
	const { dialect } = target
	const grouped = plan.group === 'value' ? g('value') : plan.group === 'value2' ? g('value2') : null
	const markers = markersCte(read, read.days, target)
	const conditions = [
		...scopeWhere(read, g('scope')),
		sql`${g('dim')} = ${kind.dim}`,
		sql`${g('dim2')} = ${kind.dim2}`,
		sql`(${dayRanges(g('day'), read.days)})`,
		...(read.hostname === undefined ? [] : [sql`${g('hostname')} = ${read.hostname}`]),
		...(read.value === undefined ? [] : [sql`${g('value')} = ${read.value}`]),
		...(read.values === undefined || grouped === null
			? []
			: [sql`${grouped} IN (${valueList(read.values)})`]),
		// An `(other)` row folds many values together: it is part of a total, never a value.
		...(grouped === null ? [] : [sql`${grouped} <> ''`]),
	]
	const key = plan.group === 'day' ? g('day') : grouped
	const keys = key === null ? [] : [sql`${key} AS ${ident(plan.group === 'day' ? 'day' : 'value')}`]
	const sums = PART_KEYS.map((part) => sql`SUM(${g(AGGREGATE_COLUMNS[part])}) AS ${ident(part)}`)
	const summed = sql`r AS (SELECT ${lines([...keys, ...sums, raw('COUNT(*) AS "n"')])}
		FROM ${markedRows(target)}
		WHERE ${join(conditions, '\n\t\t\tAND ')}${
			key === null
				? raw('')
				: sql`
		GROUP BY ${key}`
		})`
	const visible =
		plan.group === null
			? raw('')
			: sql`
	WHERE COALESCE("pageviews", 0) + COALESCE("events", 0) + COALESCE("impressions", 0) > 0`
	const ordering = [
		...[rankSql(read.order, kind.counted, dialect)].filter((rank) => rank !== null),
		...(plan.group === 'value' || plan.group === 'value2'
			? [sql`${dialect.byCodePoint(ident('value'))} ASC`]
			: []),
		...(plan.group === 'day' ? [sql`"day" ASC`] : []),
	]
	const orderBy =
		ordering.length > 0
			? sql`
	ORDER BY ${join(ordering)}`
			: raw('')
	const limit =
		read.limit === undefined
			? raw('')
			: sql`
	LIMIT ${read.limit}`
	return sql`WITH ${markers},
	${summed}
	SELECT * FROM r${visible}${orderBy}${limit}`
}
