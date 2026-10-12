import type { AnalyticsFilter } from '../../../core/contract'
import { ITEM_CLICK_EVENT } from '../../../goals/constants'
import type { SqlDialect } from '../dialect'
import { TWIN_WINDOW_MS } from '../hits'
import { ORDER_PREFIX, SERVER_ORDER_PREFIX, WIRE_ORDER_PREFIX } from '../ids'
import type { MetricParts } from '../parts'
import {
	type HitFilter,
	isAcquisition,
	isRawDimension,
	KEPT_PARTS,
	type RawAxis,
	type RawDimension,
	type RawPlan,
	readWindow,
	SESSION_ATTRIBUTES,
	SESSION_DIMENSIONS,
	SESSION_GAP_MINUTES,
	type SessionAttribute,
	visitAttributesOf,
} from '../rawRead'
import type { HitRow, HitWindow, LandingProbe, OrderKey, RawOrder, TimeWindow } from '../types'
import { HIT_COLUMNS } from './columns'
import { ident, join, raw, type SqlFragment, sql, valueList } from './fragment'

/** Where a statement runs: its dialect and the hits table, quoted as the executor names it. */
export interface SqlTarget {
	dialect: SqlDialect
	hits: SqlFragment
	/** How far apart an order's two records may lie to count as one sale; `TWIN_WINDOW_MS` absent. */
	twinWindowMs?: number | null
}

/** A hits column by its field, unqualified. */
export const column = (field: keyof HitRow): SqlFragment => ident(HIT_COLUMNS[field])

const attributeColumn = (attribute: SessionAttribute): string => HIT_COLUMNS[attribute]

/** The column the visit chain carries a visit's attribute in: `e_source`, `e_utm_campaign`. */
export const visitAttribute = (attribute: SessionAttribute): string =>
	`e_${attributeColumn(attribute)}`

/** The row alias every fact expression reads, so a joined function's own columns never collide. */
export const T = 't'

/** A column of the row `t`. */
export const t = (name: string): SqlFragment => ident(T, name)

export const tField = (field: keyof HitRow): SqlFragment => t(HIT_COLUMNS[field])

/** Fragments comma separated, one per line, as every statement lays out its select lists. */
export const lines = (fragments: readonly SqlFragment[]): SqlFragment => join(fragments, ',\n\t\t')

/** The test `scope` passes for a window's scope or scopes; none when it reads every scope. */
export const scopeWhere = (
	window: Pick<HitWindow, 'scope' | 'scopes'>,
	scope: SqlFragment
): SqlFragment[] =>
	window.scopes !== undefined
		? [sql`${scope} IN (${valueList(window.scopes)})`]
		: window.scope === undefined
			? []
			: [sql`${scope} = ${window.scope}`]

/** The hits a read starts from, before visits are cut or facts drawn. */
const baseWhere = (window: HitWindow): SqlFragment =>
	join(
		[
			...scopeWhere(window, column('scope')),
			sql`${column('ts')} >= ${window.start}`,
			sql`${column('ts')} < ${window.end}`,
			...(window.hostname === undefined ? [] : [sql`${column('hostname')} = ${window.hostname}`]),
		],
		' AND '
	)

const HIT_FIELDS: ReadonlyArray<keyof HitRow> = [
	'id',
	'scope',
	'ts',
	'hostname',
	'v',
	'type',
	'path',
	'name',
	'durationMs',
	'scrollDepth',
]

/** A goal completion's amount as sent: before it was converted, else as counted. */
const SENT_KEYS: readonly string[] = ['sent', 'value']

/** The sale a hit records, which the server's record of an order hands to the browser's. */
const MONEY_FIELDS: ReadonlyArray<keyof HitRow> = ['conversions', 'revenue']

/** The text a statement partitions, sorts or groups by. */
const KEY_FIELDS: ReadonlySet<keyof HitRow> = new Set([
	'scope',
	'hostname',
	'v',
	'path',
	'name',
	'item',
])

/**
 * `expression` as `name`, compared by code point: on Postgres byte by byte, where its own
 * collation sorts by locale rules at several times the cost.
 */
const keyed = (dialect: SqlDialect, expression: SqlFragment, name: string): SqlFragment =>
	sql`${dialect.byCodePoint(expression)} AS ${ident(name)}`

const hitField = (dialect: SqlDialect, field: keyof HitRow): SqlFragment =>
	KEY_FIELDS.has(field) && dialect.name === 'postgres'
		? keyed(dialect, column(field), HIT_COLUMNS[field])
		: column(field)

/** What the hits CTE selects beside every read's own fields. */
export interface HitColumns {
	/** Activity time and landing, to cut visits. */
	sessionize: boolean
	/** Visit attributes each hit carries, for a chain that takes a visit's from its hits. */
	attributes: readonly SessionAttribute[]
	goals: boolean
	impressions: boolean
	/**
	 * Money as it was sent: `sent_currency`, and `sent_revenue`, each goal it completed counted
	 * with its amount as sent (its `sent`, else its `value`).
	 */
	sent: boolean
}

/** The hits table's alias in `h`, which the twin lookup reads the hit's id through. */
const HIT = 'hit'

/** `ow.` and `os.` are the same length, so one offset reads the digest out of either. */
const DIGEST_FROM = raw(String(WIRE_ORDER_PREFIX.length + 1))

/** Whether `id` starts with an id prefix (with `equal` false, does not), written as a literal. */
const startsWith = (id: SqlFragment, prefix: string, equal: boolean): SqlFragment =>
	sql`substr(${id}, 1, ${raw(String(prefix.length))}) ${raw(equal ? '=' : '<>')} ${raw(`'${prefix}'`)}`

/** Whether `id` is an order's (`o`), or with `equal` false any other hit's. */
export const startsWithOrder = (id: SqlFragment, equal: boolean): SqlFragment =>
	startsWith(id, ORDER_PREFIX, equal)

/**
 * The other record of the order the hit `id` names, by primary key: `FROM ... WHERE`. With
 * `eligible`, only while the two lie within the target's twin window of each other.
 */
const twinOf = (
	target: SqlTarget,
	id: SqlFragment,
	twin: { prefix: string; eligible: boolean }
): SqlFragment => {
	const { prefix, eligible } = twin
	const windowMs = target.twinWindowMs === undefined ? TWIN_WINDOW_MS : target.twinWindowMs
	const close =
		eligible && windowMs !== null
			? sql` AND ${target.dialect.within(
					ident('twin', HIT_COLUMNS.ts),
					ident(HIT, HIT_COLUMNS.ts),
					Math.floor(windowMs / 1000)
				)}`
			: raw('')
	return sql`FROM ${target.hits} AS "twin"
				WHERE ${ident('twin', HIT_COLUMNS.id)} = ${raw(`'${prefix}'`)} || substr(${id}, ${DIGEST_FROM})${close}`
}

/**
 * A sale column as `countedHit` counts it: an `ow.` record with a stored `os.` twin takes its value
 * within the twin window, else none. Scalar subquery, unlike `EXISTS`, never hashes the table.
 */
const saleOf = (target: SqlTarget, expression: SqlFragment): SqlFragment => {
	const id = ident(HIT, HIT_COLUMNS.id)
	const stored = twinOf(target, id, { prefix: SERVER_ORDER_PREFIX, eligible: false })
	const close = twinOf(target, id, { prefix: SERVER_ORDER_PREFIX, eligible: true })
	return sql`CASE WHEN ${startsWith(id, WIRE_ORDER_PREFIX, false)} THEN ${expression}
			WHEN (SELECT 1 ${stored}) IS NULL THEN ${expression}
			ELSE (SELECT ${expression} ${close}) END`
}

/**
 * A browser record's item: the server record's within the twin window when it names one, else its
 * own. `server` is true where it is the server's, which came from no page.
 */
const creditedItem = (target: SqlTarget, field: 'item' | 'server'): SqlFragment => {
	const id = ident(HIT, HIT_COLUMNS.id)
	const own = ident(HIT, HIT_COLUMNS[field])
	const close = twinOf(target, id, { prefix: SERVER_ORDER_PREFIX, eligible: true })
	const twinItem = sql`(SELECT ${column('item')} ${close})`
	const wire = startsWith(id, WIRE_ORDER_PREFIX, true)
	return field === 'item'
		? sql`CASE WHEN ${wire} THEN COALESCE(${twinItem}, ${own}) ELSE ${own} END`
		: sql`CASE WHEN ${wire} AND ${twinItem} IS NOT NULL THEN ${target.dialect.boolean(true)} ELSE ${own} END`
}

/**
 * Leaves out the server's record of an order the browser recorded too within the twin window: its
 * sale is counted on the browser's record, in that record's visit.
 */
const unlessCredited = (target: SqlTarget): SqlFragment => {
	const id = ident(HIT, HIT_COLUMNS.id)
	const close = twinOf(target, id, { prefix: WIRE_ORDER_PREFIX, eligible: true })
	return sql`(${startsWith(id, SERVER_ORDER_PREFIX, false)}
			OR (SELECT 1 ${close}) IS NULL)`
}

/**
 * A visitor test widened to every browser record of an order, whose own sale columns are not the
 * ones it is counted with: the server's record may hand it goals or a currency it lacks.
 */
const orWireOrder = (test: SqlFragment): SqlFragment =>
	sql`(${test} OR ${startsWith(column('id'), WIRE_ORDER_PREFIX, true)})`

/**
 * `h`: one window's hits, the columns a read or a day's aggregation works from, of the visitors
 * every `kept` condition keeps alone.
 */
export const hitsCte = (
	window: HitWindow & { kept?: readonly SqlFragment[] },
	columns: HitColumns,
	target: SqlTarget
): SqlFragment => {
	const { dialect } = target
	const money = (expression: SqlFragment, name: string): SqlFragment =>
		sql`${saleOf(target, expression)} AS ${ident(name)}`
	const fields: SqlFragment[] = [
		...HIT_FIELDS.map((field) => hitField(dialect, field)),
		keyed(dialect, creditedItem(target, 'item'), HIT_COLUMNS.item),
		sql`${creditedItem(target, 'server')} AS ${ident(HIT_COLUMNS.server)}`,
		...MONEY_FIELDS.map((field) => money(column(field), HIT_COLUMNS[field])),
		sql`CASE WHEN ${column('type')} = 'engagement' THEN 1 ELSE 0 END AS "eng"`,
	]
	if (columns.sessionize) {
		fields.push(
			sql`COALESCE(${column('lastAt')}, ${column('ts')}) AS "act"`,
			column('landing'),
			...columns.attributes.map((attribute) =>
				keyed(dialect, ident(attributeColumn(attribute)), attributeColumn(attribute))
			)
		)
	}
	if (columns.goals) {
		fields.push(money(column('goals'), HIT_COLUMNS.goals))
	}
	if (columns.impressions) {
		fields.push(column('impressions'))
	}
	if (columns.sent) {
		fields.push(
			keyed(
				dialect,
				saleOf(target, sql`COALESCE(${column('originalCurrency')}, ${column('currency')})`),
				'sent_currency'
			),
			money(dialect.jsonArraySum(column('goals'), SENT_KEYS), 'sent_revenue')
		)
	}
	const kept = [...(window.kept ?? []), unlessCredited(target)].map(
		(condition) => sql`
			AND ${condition}`
	)
	return sql`h AS (SELECT ${join(fields)}
		FROM ${target.hits} AS ${ident(HIT)} WHERE ${baseWhere(window)}${join(kept, '')})`
}

/**
 * A hit's own value of a dimension as a visitor condition tests it, or null where no column holds
 * one to test (an item, carried in a JSON array as well).
 */
const hitValue = (dimension: RawDimension): SqlFragment | null => {
	switch (dimension) {
		case 'page':
			return column('path')
		case 'event':
			return sql`CASE WHEN ${column('type')} = 'event' THEN ${column('name')} END`
		case 'currency':
			return sql`COALESCE(${column('originalCurrency')}, ${column('currency')})`
		case 'goal':
		case 'item':
			return null
		default:
			return ident(attributeColumn(SESSION_DIMENSIONS[dimension]))
	}
}

/** `value` tested by a filter's operator, or null where the dialect has no regular expressions. */
const compared = (
	value: SqlFragment,
	filter: Pick<HitFilter, 'operator' | 'value'>,
	dialect: SqlDialect
): SqlFragment | null => {
	if (filter.operator === 'eq') {
		return sql`${value} = ${filter.value}`
	}
	if (filter.operator === 'contains') {
		return dialect.contains(value, filter.value)
	}
	return dialect.matches ? dialect.matches(value, filter.value) : null
}

/** The value test of a filter, or null where none is written. */
const valueTest = (filter: HitFilter, dialect: SqlDialect): SqlFragment | null => {
	const value = hitValue(filter.dimension)
	return value === null ? null : compared(value, filter, dialect)
}

/**
 * A hit's test toward a visitor condition, or null where none is written: a goal filter asks for
 * any goal completed, keeping every visitor it must; sale columns use {@link orWireOrder}.
 */
const hitTest = (filter: HitFilter, dialect: SqlDialect): SqlFragment | null => {
	if (filter.dimension === 'goal') {
		return orWireOrder(sql`${column('goals')} IS NOT NULL`)
	}
	const test = valueTest(filter, dialect)
	return test !== null && filter.dimension === 'currency' ? orWireOrder(test) : test
}

/**
 * Each visitor condition of a plan as the visitors kept: `("hostname", "v") IN (...)` the visitors
 * with a hit passing its test in its window, the scope in the key when the read spans scopes.
 */
const keptVisitors = (plan: RawPlan, target: SqlTarget): SqlFragment[] => {
	const { read } = plan
	const key = join(
		[
			...(read.scope === undefined ? ['scope' as const] : []),
			'hostname' as const,
			'v' as const,
		].map(column)
	)
	return plan.visitors.flatMap((condition) => {
		const test = condition.filter ? hitTest(condition.filter, target.dialect) : null
		if (condition.filter && test === null) {
			return []
		}
		return [
			sql`(${key}) IN (SELECT ${key} FROM ${target.hits}
				WHERE ${baseWhere(readWindow(read, condition.start))}${test === null ? raw('') : sql` AND ${test}`})`,
		]
	})
}

const baseCte = (
	plan: RawPlan,
	target: SqlTarget,
	attributes: readonly SessionAttribute[]
): SqlFragment =>
	hitsCte(
		{ ...readWindow(plan.read, plan.from), kept: keptVisitors(plan, target) },
		{
			sessionize: plan.sessionize,
			attributes: target.dialect.name === 'postgres' ? attributes : [],
			goals: plan.axis === 'goal',
			impressions: plan.axis === 'item',
			sent: plan.sent,
		},
		target
	)

/** A scoped read leaves `scope` out of every partition, so a window reuses the previous sort. */
interface Chain {
	dialect: SqlDialect
	target: SqlTarget
	visitor: SqlFragment
	/** The visit attributes the read takes a visit's value of, and no others. */
	attributes: readonly SessionAttribute[]
}

/** A visit's totals beside `s_pv`, `s_int` and `s_ms`: activity, scroll, money and item clicks. */
const VISIT_SUMS: readonly SqlFragment[] = [
	raw(`MAX(CASE WHEN "eng" = 0 THEN 1 ELSE 0 END) OVER whole AS "v_act"`),
	raw(`SUM(COALESCE("scroll_depth", 0)) OVER whole AS "v_ss"`),
	raw(
		`SUM(CASE WHEN "type" = 'pageview' AND "scroll_depth" IS NOT NULL THEN 1 ELSE 0 END) OVER whole AS "v_sc"`
	),
	raw(`SUM(COALESCE("conversions", 0)) OVER whole AS "v_conv"`),
	raw(`SUM(COALESCE("revenue", 0)) OVER whole AS "v_rev"`),
	raw(
		`SUM(CASE WHEN "type" = 'event' AND "name" = '${ITEM_CLICK_EVENT}' AND "item" IS NOT NULL AND "item" <> '' THEN 1 ELSE 0 END) OVER whole AS "v_int"`
	),
]

type Partition = Pick<Chain, 'dialect' | 'visitor'>

/** Visit starts and numbers, each visitor's hits framed by time, then id by code point. */
const numberVisits = ({ dialect, visitor }: Partition): SqlFragment[] => {
	const id = dialect.byCodePoint(ident('id'))
	const latestActivity = raw('MAX("act") OVER gap')
	return [
		sql`g AS (SELECT *, CASE WHEN "v" = '' THEN NULL
			WHEN ${latestActivity} IS NULL OR ${dialect.afterGap(ident('ts'), latestActivity, SESSION_GAP_MINUTES)} THEN 1 ELSE 0 END AS "starts"
		FROM h WINDOW gap AS (PARTITION BY ${visitor} ORDER BY "ts", ${id} ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING))`,
		sql`s AS (SELECT *, SUM("starts") OVER (PARTITION BY ${visitor} ORDER BY "ts", ${id} ROWS UNBOUNDED PRECEDING) AS "sn"
		FROM g)`,
	]
}

/**
 * Each hit's rank in its visit (non-engagements first) and its visit's totals, in one sort. With
 * `split`, a hit without a visitor is a "visit" of its own, ranked first and totalled alone.
 */
const rankInVisit = (
	{ dialect, visitor }: Partition,
	extra: readonly SqlFragment[],
	split = false
): SqlFragment => {
	const id = dialect.byCodePoint(ident('id'))
	const alone = split ? sql`, CASE WHEN "sn" IS NULL THEN ${id} END` : raw('')
	return sql`e AS (SELECT *, ROW_NUMBER() OVER sess AS "rn",
		${lines([
			...extra,
			sql`SUM(CASE WHEN "type" = 'pageview' THEN 1 ELSE 0 END) OVER whole AS "s_pv"`,
			sql`SUM(CASE WHEN "type" IN ('event', 'goal') THEN 1 ELSE 0 END) OVER whole AS "s_int"`,
			sql`SUM(COALESCE("duration_ms", 0)) OVER whole AS "s_ms"`,
		])}
		FROM s WINDOW sess AS (PARTITION BY ${visitor}, "sn"${alone} ORDER BY "eng", "ts", ${id}),
			whole AS (sess ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING))`
}

const ENTRY_ROW = raw('"rn" = 1 AND "eng" = 0')

/**
 * Whether a hit opens its visit, and whether that visit bounced: one pageview, no interaction. The
 * columns are read off `from` where a join puts another table beside it.
 */
const entryFlags = (from?: string): SqlFragment[] => {
	const c = (name: string): SqlFragment => (from === undefined ? ident(name) : ident(from, name))
	const entry = sql`${c('sn')} IS NOT NULL AND ${c('rn')} = 1 AND ${c('eng')} = 0`
	return [
		sql`CASE WHEN ${entry} THEN 1 ELSE 0 END AS "entry"`,
		sql`CASE WHEN ${entry} AND ${c('s_pv')} = 1 AND ${c('s_int')} = 0 THEN 1 ELSE 0 END AS "bounce"`,
	]
}

const ENTRY_FLAGS = entryFlags()

/** An acquisition attribute as its visit's landing set it (window `land`), else the hit's own. */
const landedValue = (attribute: SessionAttribute): SqlFragment => {
	const name = ident(attributeColumn(attribute))
	return sql`CASE WHEN "sn" IS NULL THEN ${name} ELSE FIRST_VALUE(${name}) OVER land END AS ${ident(visitAttribute(attribute))}`
}

/**
 * Postgres: windows only, and only the attributes the read takes. A join here would trust row
 * estimates (near zero for rows newer than the statistics) and loop for minutes.
 */
const windowedVisits = (chain: Chain): SqlFragment[] => {
	const { dialect, visitor } = chain
	const id = dialect.byCodePoint(ident('id'))
	const acquisition = chain.attributes.filter(isAcquisition)
	const visitorOwn = chain.attributes.filter((attribute) => !isAcquisition(attribute))
	const firstValues = visitorOwn.map((attribute) => {
		const name = attributeColumn(attribute)
		return sql`FIRST_VALUE(${ident(name)}) OVER sess AS ${ident(`f_${name}`)}`
	})
	const own = visitorOwn.map((attribute) => {
		const name = attributeColumn(attribute)
		return sql`CASE WHEN "sn" IS NULL THEN ${ident(name)} ELSE ${ident(`f_${name}`)} END AS ${ident(visitAttribute(attribute))}`
	})
	const ctes = [...numberVisits(chain), rankInVisit(chain, firstValues)]
	if (acquisition.length === 0) {
		return [
			...ctes,
			sql`a AS (SELECT *,
		${lines([...own, ...ENTRY_FLAGS])}
		FROM e)`,
		]
	}
	const landed = acquisition.map(landedValue)
	return [
		...ctes,
		sql`l AS (SELECT *, SUM(CASE WHEN ${ENTRY_ROW} AND ${dialect.isTrue(ident('landing'))} THEN 1 ELSE 0 END)
			OVER (PARTITION BY ${visitor} ORDER BY "sn", "eng", "ts", ${id} ROWS UNBOUNDED PRECEDING) AS "lq"
		FROM e)`,
		sql`a AS (SELECT *,
		${lines([...landed, ...own, ...ENTRY_FLAGS])}
		FROM l WINDOW land AS (PARTITION BY ${visitor}, CASE WHEN "lq" > 0 THEN "lq" ELSE -"sn" END
			ORDER BY "sn", "eng", "ts", ${id}))`,
	]
}

/**
 * SQLite re-sorts every window level in full, so past the visit numbers it works on one row per
 * visit (attributes fetched by id) and joins them back. A read taking no attributes joins nothing.
 */
const joinedVisits = (chain: Chain): SqlFragment[] => {
	const { dialect, target, visitor: partition } = chain
	const ctes = [...numberVisits(chain), rankInVisit(chain, [])]
	if (chain.attributes.length === 0) {
		return [
			...ctes,
			sql`a AS (SELECT *,
		${lines(ENTRY_FLAGS)}
		FROM e)`,
		]
	}
	const landing = chain.attributes.some(isAcquisition)
	const carried = chain.attributes.map((attribute) => {
		const name = ident(attributeColumn(attribute))
		const as = ident(visitAttribute(attribute))
		return isAcquisition(attribute)
			? sql`CASE WHEN "lq" > 0 THEN FIRST_VALUE(${name}) OVER land ELSE ${name} END AS ${as}`
			: sql`${name} AS ${as}`
	})
	const sameVisit = join(
		['scope', 'hostname', 'v', 'sn'].map((name) => sql`${ident('va', name)} = ${ident('e', name)}`),
		' AND '
	)
	const fetched = [
		...(landing
			? [
					sql`CASE WHEN "e"."eng" = 0 AND ${dialect.isTrue(ident('e', 'landing'))} THEN 1 ELSE 0 END AS "landed"`,
				]
			: []),
		...chain.attributes.map((attribute) => ident('x', attributeColumn(attribute))),
	]
	return [
		...ctes,
		sql`vs AS (SELECT "e"."scope", "e"."hostname", "e"."v", "e"."sn",
		${lines(fetched)}
		FROM e JOIN ${target.hits} AS "x" ON "x"."id" = "e"."id"
		WHERE "e"."sn" IS NOT NULL AND "e"."rn" = 1)`,
		...(landing
			? [
					sql`vl AS (SELECT *, SUM("landed") OVER (PARTITION BY ${partition} ORDER BY "sn" ROWS UNBOUNDED PRECEDING) AS "lq"
		FROM vs)`,
					sql`va AS (SELECT "scope", "hostname", "v", "sn",
		${lines(carried)}
		FROM vl WINDOW land AS (PARTITION BY ${partition}, "lq" ORDER BY "sn"))`,
				]
			: [
					sql`va AS (SELECT "scope", "hostname", "v", "sn",
		${lines(carried)}
		FROM vs)`,
				]),
		sql`a AS (SELECT "e".*,
		${lines([
			...chain.attributes.map((attribute) => {
				const visit = visitAttribute(attribute)
				return sql`COALESCE(${ident('va', visit)}, ${ident('o', attributeColumn(attribute))}) AS ${ident(visit)}`
			}),
			...entryFlags('e'),
		])}
		FROM e LEFT JOIN va ON ${sameVisit}
			LEFT JOIN ${target.hits} AS "o" ON "e"."sn" IS NULL AND "o"."id" = "e"."id")`,
	]
}

/**
 * A raw read's visit chain over `h`, ending in `a`: visit number `sn` (null without a visitor),
 * rank, visit totals, attributes `e_*` (a visitorless hit's own) and entry and bounce flags.
 */
const visitChain = (
	target: SqlTarget,
	options: { scoped: boolean; attributes: readonly SessionAttribute[] }
): SqlFragment[] => {
	const chain: Chain = {
		dialect: target.dialect,
		target,
		visitor: raw(options.scoped ? '"hostname", "v"' : '"scope", "hostname", "v"'),
		attributes: options.attributes,
	}
	return target.dialect.name === 'postgres' ? windowedVisits(chain) : joinedVisits(chain)
}

/** The columns of `a` a visit's row and a goal completion's row carry into `va`. */
const VISIT_ROW: readonly string[] = [
	'hostname',
	'v',
	'sn',
	'type',
	'eng',
	'name',
	'item',
	'duration_ms',
	'scroll_depth',
	'conversions',
	'goals',
	'entry',
	'bounce',
	's_pv',
	's_int',
	's_ms',
	'v_act',
	'v_ss',
	'v_sc',
	'v_conv',
	'v_rev',
	'v_int',
]

/**
 * A scope's day cut once for every kind: `va` has a row per visit (`w` 0) and per goal hit (`w` 1).
 * Goal rows take acquisition through the window, not a join whose plan would rest on row estimates.
 */
export const dayVisitChain = (target: SqlTarget, window: HitWindow): SqlFragment[] => {
	const { dialect } = target
	const partition = { dialect, visitor: raw('"hostname", "v"') }
	const x = (name: string): SqlFragment => ident('x', name)
	const row = VISIT_ROW.map((name) => t(name))
	const fetched = lines(
		SESSION_ATTRIBUTES.map(attributeColumn).map((name) => keyed(dialect, x(name), name))
	)
	const inWindow = join(
		[
			...scopeWhere(window, x(HIT_COLUMNS.scope)),
			sql`${x(HIT_COLUMNS.ts)} >= ${window.start}`,
			sql`${x(HIT_COLUMNS.ts)} < ${window.end}`,
		],
		' AND '
	)
	const carried = SESSION_ATTRIBUTES.map((attribute) =>
		isAcquisition(attribute)
			? landedValue(attribute)
			: sql`${ident(attributeColumn(attribute))} AS ${ident(visitAttribute(attribute))}`
	)
	return [
		...numberVisits(partition),
		rankInVisit(partition, VISIT_SUMS, true),
		sql`a AS MATERIALIZED (SELECT *,
		${lines(ENTRY_FLAGS)}
		FROM e)`,
		sql`vs AS (SELECT ${lines(row)}, 0 AS "w",
		CASE WHEN "t"."eng" = 0 AND ${dialect.isTrue(t('landing'))} THEN 1 ELSE 0 END AS "landed",
		${fetched}
		FROM a AS "t" JOIN ${target.hits} AS "x" ON ${x(HIT_COLUMNS.id)} = ${t(HIT_COLUMNS.id)} AND ${inWindow}
		WHERE "t"."rn" = 1
		UNION ALL
		SELECT ${lines(row)}, 1, 0,
		${fetched}
		FROM a AS "t" LEFT JOIN ${target.hits} AS "x" ON "t"."sn" IS NULL AND ${x(HIT_COLUMNS.id)} = ${t(HIT_COLUMNS.id)}
		WHERE "t"."goals" IS NOT NULL)`,
		sql`vl AS (SELECT *, SUM("landed") OVER (PARTITION BY "hostname", "v" ORDER BY "sn", "w" ROWS UNBOUNDED PRECEDING) AS "lq"
		FROM vs)`,
		sql`va AS MATERIALIZED (SELECT ${lines([...VISIT_ROW.map((name) => ident(name)), ident('w'), ...carried])}
		FROM vl WINDOW land AS (PARTITION BY "hostname", "v", CASE WHEN "lq" > 0 THEN "lq" ELSE -"sn" END ORDER BY "sn", "w"))`,
	]
}

/** The aliases of an unnested `goals` element and an unnested `impressions` element. */
export const GOAL = 'gl'
const SEEN = 'i'

/** The goal completion a goal fact counts, from the unnested `goals` element. */
export const goalField = (dialect: SqlDialect, key: 'slug' | 'value' | 'sent'): SqlFragment =>
	dialect.jsonField(ident(GOAL, 'value'), key, key === 'slug' ? 'text' : 'real')

/** A dimension's value on a fact row. */
const dimension = (plan: RawPlan, dialect: SqlDialect, key: RawDimension): SqlFragment => {
	switch (key) {
		case 'page':
			return plan.axis === 'item'
				? sql`CASE WHEN ${dialect.isTrue(tField('server'))} THEN NULL ELSE ${tField('path')} END`
				: tField('path')
		case 'event':
			return sql`CASE WHEN ${tField('type')} = 'event' THEN ${tField('name')} END`
		case 'goal':
			return goalField(dialect, 'slug')
		case 'item':
			return t('x')
		case 'currency':
			return t('sent_currency')
		default:
			return t(visitAttribute(SESSION_DIMENSIONS[key]))
	}
}

const filterSql = (plan: RawPlan, dialect: SqlDialect, filter: AnalyticsFilter): SqlFragment => {
	if (!isRawDimension(filter.dimension)) {
		throw new Error(`analytics: raw reads cannot filter by "${filter.dimension}"`)
	}
	const test = compared(dimension(plan, dialect, filter.dimension), filter, dialect)
	if (test === null) {
		throw new Error(`analytics: ${dialect.name} has no regular expressions to filter with`)
	}
	return test
}

/** The bucket of a fact's time: a search halving the starts, so a long series costs a few tests. */
const bucketSql = (buckets: readonly Date[], low: number, high: number): SqlFragment => {
	if (low >= high) {
		return raw(String(low))
	}
	const middle = Math.ceil((low + high) / 2)
	const start = buckets[middle]
	if (start === undefined) {
		return raw(String(low))
	}
	return sql`CASE WHEN ${tField('ts')} < ${start} THEN ${bucketSql(buckets, low, middle - 1)} ELSE ${bucketSql(buckets, middle, high)} END`
}

/** The facts a read counts: their axis, and whether revenue is counted as each amount was sent. */
export interface FactKind {
	axis: RawAxis
	sent?: boolean
}

/**
 * What one fact of a kind adds to each counted part. A goal completion counts a conversion unless
 * its hit counts none (a refund); with `sent`, revenue is each amount as sent.
 */
export const contributionsOf = (
	{ axis, sent = false }: FactKind,
	counted: ReadonlySet<keyof MetricParts>,
	dialect: SqlDialect
): Map<keyof MetricParts, SqlFragment> => {
	const goal = axis === 'goal'
	const item = axis === 'item'
	const completion = sql`COALESCE(${goalField(dialect, 'value')}, 0)`
	const all = new Map<keyof MetricParts, SqlFragment>([
		['pageviews', sql`CASE WHEN ${tField('type')} = 'pageview' THEN 1 ELSE 0 END`],
		['events', sql`CASE WHEN ${tField('type')} IN ('event', 'goal') THEN 1 ELSE 0 END`],
		[
			'visitors',
			item
				? sql`CASE WHEN ${tField('v')} <> '' THEN 1 ELSE 0 END`
				: sql`CASE WHEN ${t('eng')} = 0 AND ${tField('v')} <> '' THEN 1 ELSE 0 END`,
		],
		['sessions', sql`CASE WHEN ${t('eng')} = 0 AND ${t('sn')} IS NOT NULL THEN 1 ELSE 0 END`],
		['entries', t('entry')],
		['bounces', t('bounce')],
		['sessionMs', t('s_ms')],
		['durationMs', sql`COALESCE(${tField('durationMs')}, 0)`],
		['scrollSum', sql`COALESCE(${tField('scrollDepth')}, 0)`],
		[
			'scrollSamples',
			sql`CASE WHEN ${tField('type')} = 'pageview' AND ${tField('scrollDepth')} IS NOT NULL THEN 1 ELSE 0 END`,
		],
		[
			'conversions',
			goal
				? sql`CASE WHEN COALESCE(${tField('conversions')}, 0) > 0 THEN 1 ELSE 0 END`
				: sql`COALESCE(${tField('conversions')}, 0)`,
		],
		[
			'revenue',
			goal
				? sent
					? sql`COALESCE(${goalField(dialect, 'sent')}, ${goalField(dialect, 'value')}, 0)`
					: completion
				: sql`COALESCE(${sent ? t('sent_revenue') : tField('revenue')}, 0)`,
		],
		['impressions', t('imp')],
		[
			'interactions',
			sql`CASE WHEN ${tField('type')} = 'event' AND ${tField('name')} = ${raw(`'${ITEM_CLICK_EVENT}'`)} AND ${tField('item')} IS NOT NULL AND ${tField('item')} <> '' THEN 1 ELSE 0 END`,
		],
	])
	return new Map([...all].filter(([part]) => counted.has(part)))
}

/** CTE `name`: each item clicked (`imp` 0) or seen (`imp` 1) in `from`'s rows, the item in `x`. */
export const itemFacts = (name: string, from: SqlFragment, dialect: SqlDialect): SqlFragment =>
	sql`${raw(name)} AS (SELECT ${ident(T)}.*, ${tField('item')} AS "x", 0 AS "imp" FROM ${from}
			WHERE ${t('eng')} = 0 AND ${tField('item')} IS NOT NULL AND ${tField('item')} <> ''
		UNION ALL
		SELECT ${ident(T)}.*, ${ident(SEEN, 'value')} AS "x", 1 AS "imp" FROM ${from}
			${dialect.crossJoinJsonArray(tField('impressions'), SEEN, 'text')}
			WHERE ${t('eng')} = 1)`

/** The rows facts are drawn from: each hit, each goal completion, or each item clicked or seen. */
const factSource = (
	plan: RawPlan,
	dialect: SqlDialect,
	chain: string
): { ctes: SqlFragment[]; from: SqlFragment } => {
	const from = sql`${ident(chain)} AS ${ident(T)}`
	if (plan.axis === 'goal') {
		return {
			ctes: [],
			from: sql`${from} ${dialect.crossJoinJsonArray(tField('goals'), GOAL, 'json')}`,
		}
	}
	if (plan.axis !== 'item') {
		return { ctes: [], from }
	}
	return { ctes: [itemFacts('f', from, dialect)], from: sql`${ident('f')} AS ${ident(T)}` }
}

const factConditions = (plan: RawPlan, dialect: SqlDialect): SqlFragment[] => {
	const { read } = plan
	const conditions: SqlFragment[] = []
	if (plan.from < read.start) {
		conditions.push(sql`${tField('ts')} >= ${read.start}`)
	}
	for (const filter of read.filters) {
		conditions.push(filterSql(plan, dialect, filter))
	}
	if (read.path !== undefined) {
		conditions.push(sql`${dimension(plan, dialect, 'page')} = ${read.path}`)
	}
	if (read.item !== undefined) {
		conditions.push(sql`${t('x')} = ${read.item}`)
	}
	if (plan.group !== undefined) {
		const value = dimension(plan, dialect, plan.group)
		conditions.push(sql`${value} IS NOT NULL AND ${value} <> ''`)
		if (read.values !== undefined) {
			conditions.push(
				read.values.length === 0 ? raw('1 = 0') : sql`${value} IN (${valueList(read.values)})`
			)
		}
	}
	return conditions
}

const quoted = (part: keyof MetricParts): SqlFragment => ident(part)

/** How a part folds from facts to visits to visitors to the row. */
export const fold = (part: keyof MetricParts, level: 'visit' | 'visitor' | 'row'): SqlFragment => {
	const name = quoted(part)
	const perVisit = part === 'sessions' || part === 'sessionMs'
	if ((part === 'visitors' && level !== 'row') || (perVisit && level === 'visit')) {
		return sql`MAX(${name}) AS ${name}`
	}
	if (part === 'sessionMs' && level === 'visitor') {
		return sql`SUM(CASE WHEN "sessions" = 1 THEN ${name} ELSE 0 END) AS ${name}`
	}
	return sql`SUM(${name}) AS ${name}`
}

/** How rows named by their parts rank: none when the order names a part the rows never count. */
export const rankSql = (
	order: RawOrder | undefined,
	counted: ReadonlySet<keyof MetricParts>,
	dialect: SqlDialect
): SqlFragment | null => {
	if (!order || !counted.has(order.part)) {
		return null
	}
	const direction = raw(order.dir === 'asc' ? 'ASC' : 'DESC')
	if (order.per === undefined) {
		return sql`${quoted(order.part)} ${direction} NULLS LAST`
	}
	if (!counted.has(order.per)) {
		return null
	}
	return sql`${dialect.cast(quoted(order.part), 'real')} / NULLIF(${dialect.cast(quoted(order.per), 'real')}, 0) ${direction} NULLS LAST`
}

/**
 * One statement: the window's hits, the visit chain, the facts filtered after visits are cut, then
 * folds into visits, visitors and rows, so each visit and visitor counts once per row.
 */
export const compileRawRead = (plan: RawPlan, target: SqlTarget): SqlFragment => {
	const { dialect } = target
	const { read } = plan
	const attributes = visitAttributesOf(plan)
	const ctes: SqlFragment[] = [baseCte(plan, target, attributes)]
	if (plan.sessionize) {
		ctes.push(...visitChain(target, { scoped: read.scope !== undefined, attributes }))
	}
	const { ctes: factCtes, from } = factSource(plan, dialect, plan.sessionize ? 'a' : 'h')
	ctes.push(...factCtes)
	const keys: SqlFragment[] = []
	const keyNames: string[] = []
	if (plan.group !== undefined) {
		keys.push(sql`${dimension(plan, dialect, plan.group)} AS "gv"`)
		keyNames.push('gv')
	}
	if (read.buckets !== undefined) {
		keys.push(sql`${bucketSql(read.buckets, 0, read.buckets.length - 1)} AS "bk"`)
		keyNames.push('bk')
	}
	const parts = contributionsOf({ axis: plan.axis, sent: plan.sent }, plan.counted, dialect)
	const visits = plan.counted.has('sessions')
	const person = ['scope', 'hostname', 'v']
	const conditions = factConditions(plan, dialect)
	ctes.push(sql`q AS (SELECT ${lines([
		...keys,
		...person.map((name) => t(name)),
		...(visits ? [t('sn')] : []),
		...[...parts].map(([part, value]) => sql`${value} AS ${quoted(part)}`),
	])}
		FROM ${from}${
			conditions.length > 0
				? sql`
		WHERE ${join(conditions, '\n\t\t\tAND ')}`
				: raw('')
		})`)
	const partNames = [...parts.keys()]
	const groupBy = (names: readonly string[]): SqlFragment => join(names.map((name) => ident(name)))
	let previous = 'q'
	if (visits) {
		const names = [...keyNames, ...person, 'sn']
		ctes.push(sql`k AS (SELECT ${lines([
			...names.map((name) => ident(name)),
			...partNames.map((part) => fold(part, 'visit')),
		])}
		FROM q GROUP BY ${groupBy(names)})`)
		previous = 'k'
	}
	const visitorNames = [...keyNames, ...person]
	ctes.push(sql`p AS (SELECT ${lines([
		...visitorNames.map((name) => ident(name)),
		...partNames.map((part) => fold(part, 'visitor')),
	])}
		FROM ${raw(previous)} GROUP BY ${groupBy(visitorNames)})`)
	ctes.push(sql`r AS (SELECT ${lines([
		...(plan.group !== undefined ? [sql`"gv" AS "value"`] : []),
		...(read.buckets !== undefined ? [sql`"bk" AS "bucket"`] : []),
		...partNames.map((part) => fold(part, 'row')),
	])}
		FROM p${keyNames.length > 0 ? sql` GROUP BY ${groupBy(keyNames)}` : raw('')})`)
	const grouped = keyNames.length > 0
	const kept = KEPT_PARTS.filter((part) => plan.counted.has(part))
	const having = grouped
		? sql`
	WHERE ${join(kept.map(quoted), ' + ')} > 0`
		: raw('')
	const ordering = [
		...[rankSql(read.order, plan.counted, dialect)].filter((rank) => rank !== null),
		...(plan.group !== undefined ? [sql`${dialect.byCodePoint(ident('value'))} ASC`] : []),
		...(read.buckets !== undefined ? [sql`"bucket" ASC`] : []),
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
	return sql`WITH ${join(ctes, ',\n\t')}
	SELECT * FROM r${having}${orderBy}${limit}`
}

/** Up to `limit` + 1 window hits counted off the `(scope, ts)` index, to bound a read's work. */
export const compileRangeCount = (
	window: HitWindow,
	target: SqlTarget,
	limit: number
): SqlFragment =>
	sql`SELECT COUNT(*) AS "n" FROM (SELECT 1 FROM ${target.hits} WHERE ${baseWhere(window)} LIMIT ${limit + 1}) AS "c"`

/** {@link compileRangeCount} of each scope named, one bounded probe of the index per scope. */
export const compileRangeCounts = (
	window: Omit<TimeWindow, 'scope'> & { scopes: readonly string[] },
	target: SqlTarget,
	limit: number
): SqlFragment => {
	const h = (field: keyof HitRow): SqlFragment => ident('h', HIT_COLUMNS[field])
	return sql`WITH "s"("scope") AS (VALUES ${join(window.scopes.map((scope) => sql`(${scope})`))})
	SELECT "s"."scope" AS "scope", (SELECT COUNT(*) FROM (SELECT 1 FROM ${target.hits} AS "h"
		WHERE ${h('scope')} = "s"."scope" AND ${h('ts')} >= ${window.start} AND ${h('ts')} < ${window.end}
		LIMIT ${limit + 1}) AS "c") AS "n" FROM "s"`
}

export const compileHasHits = (window: TimeWindow, target: SqlTarget): SqlFragment =>
	sql`SELECT 1 AS "hit" FROM ${target.hits} WHERE ${baseWhere(window)} LIMIT 1`

export const compileHitById = (id: string, target: SqlTarget): SqlFragment =>
	sql`SELECT * FROM ${target.hits} WHERE ${column('id')} = ${id}`

/** A visitor's latest landing pageview in a window, read backwards off the `(scope, ts)` index. */
export const compileLatestLanding = (probe: LandingProbe, target: SqlTarget): SqlFragment =>
	sql`SELECT * FROM ${target.hits}
		WHERE ${column('scope')} = ${probe.scope} AND ${column('ts')} >= ${probe.start} AND ${column('ts')} <= ${probe.end}
			AND ${column('hostname')} = ${probe.hostname} AND ${column('v')} = ${probe.v}
			AND ${column('type')} = 'pageview' AND ${target.dialect.isTrue(column('landing'))}
		ORDER BY ${column('ts')} DESC, ${target.dialect.byCodePoint(column('id'))} DESC
		LIMIT 1`

/** A window's order records after `after`, oldest first by time and id, at most `limit`. */
export const compileOrdersIn = (
	window: TimeWindow & { limit: number; after?: OrderKey },
	target: SqlTarget
): SqlFragment => {
	const id = target.dialect.byCodePoint(column('id'))
	const ts = column('ts')
	const { after } = window
	return sql`SELECT ${column('id')} AS "id", ${ts} AS "ts" FROM ${target.hits}
		WHERE ${baseWhere(window)} AND ${startsWithOrder(column('id'), true)}${
			after === undefined
				? raw('')
				: sql` AND (${ts} > ${after.ts} OR (${ts} = ${after.ts} AND ${id} > ${after.id}))`
		}
		ORDER BY ${ts}, ${id}
		LIMIT ${window.limit}`
}

/** Every scope, one index probe each: the next scope after the last found, until none is left. */
export const compileScopes = (target: SqlTarget): SqlFragment => {
	const scope = column('scope')
	return sql`WITH RECURSIVE "s"("scope") AS (SELECT MIN(${scope}) FROM ${target.hits}
		UNION ALL
		SELECT (SELECT MIN(${ident('h', HIT_COLUMNS.scope)}) FROM ${target.hits} AS "h" WHERE ${ident('h', HIT_COLUMNS.scope)} > ${ident('s', 'scope')}) FROM "s" WHERE ${ident('s', 'scope')} IS NOT NULL)
	SELECT "scope" FROM "s" WHERE "scope" IS NOT NULL`
}
