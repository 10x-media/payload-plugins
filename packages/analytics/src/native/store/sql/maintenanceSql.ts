import type { CalendarDay } from '../../../timeframe/calendar'
import { TOMBSTONE_CLEARED } from '../hits'
import type { ChannelTuple, TimeWindow } from '../types'
import type { AggregateTarget } from './aggregateSql'
import { column, type SqlTarget, startsWithOrder } from './compile'
import { join, raw, type SqlFragment, sql } from './fragment'

/** The earliest hit of a scope, off the `(scope, ts)` index. */
export const compileOldestHit = (scope: string, target: SqlTarget): SqlFragment =>
	sql`SELECT MIN(${column('ts')}) AS "ts" FROM ${target.hits} WHERE ${column('scope')} = ${scope}`

/** A prune's window of one scope's hits: from `from`, when given, up to `before`. */
export interface PruneWindow {
	scope: string
	before: Date
	from?: Date
	limit: number
}

const inPrune = (prune: PruneWindow): SqlFragment =>
	sql`${column('scope')} = ${prune.scope}${
		prune.from === undefined ? raw('') : sql` AND ${column('ts')} >= ${prune.from}`
	} AND ${column('ts')} < ${prune.before}`

/**
 * Up to `limit` of a scope's hits in a prune's window, an order's records aside, deleted by id: one
 * bounded statement, so pruning a long backlog never holds one huge delete.
 */
export const compilePruneHits = (prune: PruneWindow, target: SqlTarget): SqlFragment =>
	sql`DELETE FROM ${target.hits} WHERE ${column('id')} IN (SELECT ${column('id')} FROM ${target.hits}
		WHERE ${inPrune(prune)} AND ${startsWithOrder(column('id'), false)} LIMIT ${prune.limit})`

/**
 * Up to `limit` of a scope's order records in a prune's window that still hold anything of their
 * visit, each turned into its tombstone (`tombstoneOf`): `v` emptied and the rest cleared.
 */
export const compileTombstones = (prune: PruneWindow, target: SqlTarget): SqlFragment => {
	const holds = join(
		[
			sql`${column('v')} <> ''`,
			...TOMBSTONE_CLEARED.map((field) => sql`${column(field)} IS NOT NULL`),
		],
		' OR '
	)
	const cleared = TOMBSTONE_CLEARED.map((field) => sql`${column(field)} = NULL`)
	return sql`UPDATE ${target.hits} SET ${join([sql`${column('v')} = ''`, ...cleared])}
		WHERE ${column('id')} IN (SELECT ${column('id')} FROM ${target.hits}
			WHERE ${inPrune(prune)} AND ${startsWithOrder(column('id'), true)} AND (${holds}) LIMIT ${prune.limit})`
}

/** Up to `limit` of a scope's order records from before `before`, deleted by id. */
export const compileExpireOrders = (
	prune: { scope: string; before: Date; limit: number },
	target: SqlTarget
): SqlFragment =>
	sql`DELETE FROM ${target.hits} WHERE ${column('id')} IN (SELECT ${column('id')} FROM ${target.hits}
		WHERE ${column('scope')} = ${prune.scope} AND ${column('ts')} < ${prune.before}
			AND ${startsWithOrder(column('id'), true)} LIMIT ${prune.limit})`

/** Up to `limit` of a scope's aggregate rows of days before `beforeDay`, deleted by id. */
export const compilePruneAggregates = (
	prune: { scope: string; beforeDay: CalendarDay; limit: number },
	target: AggregateTarget
): SqlFragment =>
	sql`DELETE FROM ${target.aggregates} WHERE "id" IN (SELECT "id" FROM ${target.aggregates}
		WHERE "scope" = ${prune.scope} AND "day" < ${prune.beforeDay} LIMIT ${prune.limit})`

/** A window's hits classified under a taxonomy older than `version`. */
const olderThan = (window: TimeWindow, version: number): SqlFragment =>
	sql`${column('scope')} = ${window.scope} AND ${column('ts')} >= ${window.start} AND ${column('ts')} < ${window.end}
		AND ${column('channelVersion')} < ${version}`

/** The distinct tuples a window's hits of an older taxonomy were classified from. */
export const compileChannelTuples = (
	window: TimeWindow,
	version: number,
	target: SqlTarget
): SqlFragment =>
	sql`SELECT DISTINCT ${join([
		sql`${column('ref')} AS "ref"`,
		sql`${column('utmSource')} AS "utmSource"`,
		sql`${column('utmMedium')} AS "utmMedium"`,
		sql`${column('clickId')} AS "clickId"`,
	])} FROM ${target.hits} WHERE ${olderThan(window, version)}`

/** One tuple, matched null-safely: `IS NOT DISTINCT FROM` on Postgres, `IS` on SQLite. */
const tupleMatch = (tuple: ChannelTuple, target: SqlTarget): SqlFragment => {
	const equal = (field: 'ref' | 'utmSource' | 'utmMedium' | 'clickId'): SqlFragment =>
		target.dialect.nullSafeEquals(column(field), tuple[field])
	return sql`(${join([equal('ref'), equal('utmSource'), equal('utmMedium'), equal('clickId')], ' AND ')})`
}

/** Moves a slice's hits of the given tuples to `channel` under `version`. */
export const compileReclassify = (
	slice: TimeWindow,
	change: { channel: string; version: number; tuples: readonly ChannelTuple[] },
	target: SqlTarget
): SqlFragment =>
	sql`UPDATE ${target.hits} SET ${column('channel')} = ${change.channel}, ${column('channelVersion')} = ${change.version}
		WHERE ${olderThan(slice, change.version)}
			AND (${join(
				change.tuples.map((tuple) => tupleMatch(tuple, target)),
				' OR '
			)})`
