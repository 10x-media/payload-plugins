import { randomBytes } from 'node:crypto'
import { currentDate } from '../../../core/clock'
import { STATE_SLUG } from '../../collections/slugs'
import { chunksOf } from '../chunks'
import { dateOf, jsonOf } from '../columnValues'
import { compareCodePoints } from '../rawRead'
import {
	atOf,
	checkStateLimit,
	cursorKey,
	cursorOf,
	dayFinalAfter,
	dayKey,
	dropKey,
	dropOf,
	epochStateKey,
	heartbeatKey,
	leaseUntilFrom,
	markersOf,
	markerValue,
	openDueBy,
	prunedKey,
	saltExpiresAt,
	saltKey,
	stateKindOf,
	tokenOf,
} from '../state'
import type {
	CompleteGuard,
	DayMarker,
	DropNote,
	NewDayMarker,
	StateStore,
	StateStoreOptions,
} from '../types'
import type { SqlExecutor } from './executor'
import {
	ident,
	join,
	json,
	raw,
	type SqlArgument,
	type SqlFragment,
	sql,
	valueList,
} from './fragment'

/** Keys or rows per statement, well under SQLite's bound parameter limit. */
const CHUNK = 500

/** The SQL state store also hands out the statement completing a day, for a caller's batch. */
export interface SqlStateStore extends StateStore {
	/** Completes `marker` while `owner` holds its lease: one row changed, else none. */
	completion(marker: DayMarker, owner: string, guard?: CompleteGuard): SqlFragment
}

const id = ident('id')
const kind = ident('kind')
const scope = ident('scope')
const day = ident('day')
const tz = ident('tz')
const status = ident('status')
const version = ident('version')
const gen = ident('gen')
const hits = ident('hits')
const leaseOwner = ident('lease_owner')
const leaseUntil = ident('lease_until')
const finalAfter = ident('final_after')
const aggregatedAt = ident('aggregated_at')
const value = ident('value')
const expiresAt = ident('expires_at')

/** A marker's columns under its field names, so a row reads back the way a Mongo document does. */
const MARKER_COLUMNS = join([
	scope,
	day,
	tz,
	value,
	status,
	version,
	gen,
	hits,
	sql`${leaseOwner} AS ${ident('leaseOwner')}`,
	sql`${leaseUntil} AS ${ident('leaseUntil')}`,
	sql`${finalAfter} AS ${ident('finalAfter')}`,
	sql`${aggregatedAt} AS ${ident('aggregatedAt')}`,
])

/** The upsert's name for the existing row: beside `excluded`, a bare column would be ambiguous. */
const EXISTING = 's'

/** Whether a lease is free for `owner` at `now`: never taken, expired, or `owner`'s own. */
const leaseFree = (now: Date, owner: string, row?: string): SqlFragment => {
	const until = row ? ident(row, 'lease_until') : leaseUntil
	const holder = row ? ident(row, 'lease_owner') : leaseOwner
	return sql`(${until} IS NULL OR ${until} < ${now} OR ${holder} = ${owner})`
}

/** A marker's `value`: where its count started when not at the day's start, else NULL. */
const markerJson = (marker: DayMarker): SqlFragment => {
	const kept = markerValue(marker)
	return kept === null ? sql`${null}` : json(kept)
}

const tuples = (rows: readonly SqlArgument[][]): SqlFragment =>
	join(rows.map((row) => sql`(${valueList(row)})`))

/**
 * The state store on Postgres or SQLite. Every statement goes through the engine's executor, on
 * the adapter's own pool or client and never inside a transaction the host holds open.
 */
export const sqlStateStore = (
	executor: SqlExecutor,
	options: StateStoreOptions = {}
): SqlStateStore => {
	const now = options.now ?? currentDate
	const table = executor.table(options.slug ?? STATE_SLUG)
	const sqlite = executor.dialect.name === 'sqlite'
	/** SQLite hands JSON back as its text; node-postgres parses `jsonb` itself, a string included. */
	const valueAt = async (key: string): Promise<unknown> => {
		const [row] = await executor.select(sql`SELECT ${value} FROM ${table} WHERE ${id} = ${key}`)
		if (!row) {
			return undefined
		}
		return sqlite ? jsonOf(row.value) : row.value
	}

	const completion = (marker: DayMarker, owner: string, guard?: CompleteGuard): SqlFragment =>
		sql`UPDATE ${table} SET ${status} = ${marker.status}, ${tz} = ${marker.tz},
				${value} = ${markerJson(marker)},
				${version} = ${marker.version}, ${gen} = ${marker.gen}, ${hits} = ${marker.hits},
				${finalAfter} = ${marker.finalAfter}, ${aggregatedAt} = ${marker.aggregatedAt},
				${leaseOwner} = ${null}, ${leaseUntil} = ${null}
			WHERE ${id} = ${dayKey(marker.scope, marker.day)} AND ${leaseOwner} = ${owner}${
				guard?.clean === true ? sql` AND ${status} <> ${'dirty'}` : raw('')
			}`

	return {
		async salt(date) {
			const key = saltKey(date)
			const fresh = randomBytes(32).toString('base64url')
			await executor.execute(
				sql`INSERT INTO ${table} (${join([id, kind, scope, day, value, expiresAt])})
					VALUES (${key}, ${'salt'}, ${''}, ${date}, ${json(fresh)}, ${saltExpiresAt(date)})
					ON CONFLICT (${id}) DO NOTHING`
			)
			const stored = await valueAt(key)
			if (typeof stored === 'string' && stored !== '') {
				return stored
			}
			// A backdated hit's day may be past its salt's expiry, and a concurrent sweep then deletes
			// the row between the two statements: that is the sweep's job, and the salt written serves.
			if (saltExpiresAt(date).getTime() <= now().getTime()) {
				return fresh
			}
			throw new Error(`analytics: the salt "${key}" could not be read back`)
		},

		async markers(of, from, to) {
			if (to < from) {
				return []
			}
			const rows = await executor.select(
				sql`SELECT ${MARKER_COLUMNS} FROM ${table}
					WHERE ${kind} = ${'day'} AND ${scope} = ${of} AND ${day} >= ${from} AND ${day} <= ${to}
					ORDER BY ${day}`
			)
			return markersOf(rows).sort((a, b) => a.day - b.day)
		},

		async markersIn(scopes, from, to) {
			if (to < from) {
				return []
			}
			const found: DayMarker[] = []
			for (const chunk of chunksOf([...new Set(scopes)], CHUNK)) {
				const rows = await executor.select(
					sql`SELECT ${MARKER_COLUMNS} FROM ${table}
						WHERE ${kind} = ${'day'} AND ${scope} IN (${valueList(chunk)})
							AND ${day} >= ${from} AND ${day} <= ${to}`,
					'long'
				)
				found.push(...markersOf(rows))
			}
			return found.sort((a, b) => compareCodePoints(a.scope, b.scope) || a.day - b.day)
		},

		async ensureMarkers(markers) {
			const unique = new Map<string, NewDayMarker>()
			for (const marker of markers) {
				unique.set(dayKey(marker.scope, marker.day), marker)
			}
			for (const chunk of chunksOf([...unique], CHUNK)) {
				const rows = chunk.map(([key, marker]): SqlArgument[] => [
					key,
					'day',
					marker.scope,
					marker.day,
					marker.tz,
					'open',
					dayFinalAfter(marker.day, marker.tz),
				])
				await executor.execute(
					sql`INSERT INTO ${table} (${join([id, kind, scope, day, tz, status, finalAfter])})
						VALUES ${tuples(rows)}
						ON CONFLICT (${id}) DO NOTHING`
				)
			}
		},

		async claim(key, owner, ttlMs) {
			const keyKind = stateKindOf(key)
			const at = now()
			const until = leaseUntilFrom(at, ttlMs)
			if (keyKind === 'day') {
				const { rowCount } = await executor.execute(
					sql`UPDATE ${table} SET ${leaseOwner} = ${owner}, ${leaseUntil} = ${until}
						WHERE ${id} = ${key} AND ${leaseFree(at, owner)}`
				)
				return rowCount === 1
			}
			if (keyKind !== 'lease') {
				throw new Error(`analytics: "${key}" is neither a lease nor a day marker`)
			}
			const { rowCount } = await executor.execute(
				sql`INSERT INTO ${table} AS ${ident(EXISTING)} (${join([id, kind, scope, leaseOwner, leaseUntil])})
					VALUES (${key}, ${keyKind}, ${''}, ${owner}, ${until})
					ON CONFLICT (${id}) DO UPDATE SET ${leaseOwner} = excluded.${leaseOwner}, ${leaseUntil} = excluded.${leaseUntil}
					WHERE ${leaseFree(at, owner, EXISTING)}`
			)
			return rowCount === 1
		},

		async renew(key, owner, ttlMs) {
			const until = leaseUntilFrom(now(), ttlMs)
			const { rowCount } = await executor.execute(
				sql`UPDATE ${table} SET ${leaseUntil} = ${until} WHERE ${id} = ${key} AND ${leaseOwner} = ${owner}`
			)
			return rowCount === 1
		},

		async held(key) {
			const [row] = await executor.select(
				sql`SELECT ${leaseUntil} AS ${ident('leaseUntil')} FROM ${table} WHERE ${id} = ${key}`
			)
			const until = row ? dateOf(row.leaseUntil) : null
			return until !== null && until.getTime() >= now().getTime()
		},

		async release(key, owner) {
			const { rowCount } = await executor.execute(
				sql`UPDATE ${table} SET ${leaseOwner} = ${null}, ${leaseUntil} = ${null}
					WHERE ${id} = ${key} AND ${leaseOwner} = ${owner}`
			)
			return rowCount === 1
		},

		completion,

		async complete(marker, owner, guard) {
			const { rowCount } = await executor.execute(completion(marker, owner, guard))
			return rowCount === 1
		},

		async attempt(marker, owner) {
			const { rowCount } = await executor.execute(
				sql`UPDATE ${table} SET ${status} = ${marker.status}, ${value} = ${markerJson(marker)}
					WHERE ${id} = ${dayKey(marker.scope, marker.day)} AND ${leaseOwner} = ${owner}`
			)
			return rowCount === 1
		},

		async markDirty(of, days) {
			for (const chunk of chunksOf([...new Set(days)], CHUNK)) {
				const keys = valueList(chunk.map((date) => dayKey(of, date)))
				await executor.execute(
					sql`UPDATE ${table} SET ${status} = ${'dirty'}, ${leaseOwner} = ${null}, ${leaseUntil} = ${null},
							${value} = ${executor.dialect.jsonWithout(value, 'failures')}
						WHERE ${id} IN (${keys}) AND ${kind} = ${'day'}`
				)
			}
		},

		async pending(at, limit, after) {
			checkStateLimit('pending', limit)
			const byScope = executor.dialect.byCodePoint(scope)
			const rows = await executor.select(
				sql`SELECT ${MARKER_COLUMNS} FROM ${table}
					WHERE ${kind} = ${'day'}
						AND (${leaseUntil} IS NULL OR ${leaseUntil} < ${at})
						AND (${status} = ${'dirty'}
							OR (${status} IN (${'open'}, ${'partial'}) AND ${finalAfter} <= ${openDueBy(at)})
							OR (${status} = ${'provisional'} AND ${finalAfter} <= ${at}))${
								after === undefined
									? raw('')
									: sql`
						AND (${day} > ${after.day} OR (${day} = ${after.day} AND ${byScope} > ${after.scope}))`
							}
					ORDER BY ${day}, ${byScope}
					LIMIT ${limit}`
			)
			return markersOf(rows)
		},

		async dropMarkers(of, beforeDay) {
			const { rowCount } = await executor.execute(
				sql`DELETE FROM ${table} WHERE ${kind} = ${'day'} AND ${scope} = ${of} AND ${day} < ${beforeDay}`
			)
			return rowCount
		},

		async prunedBefore(of) {
			return atOf(await valueAt(prunedKey(of)))
		},

		async prunedBeforeIn(scopes) {
			const found = new Map<string, Date>()
			for (const chunk of chunksOf([...new Set(scopes)], CHUNK)) {
				const rows = await executor.select(
					sql`SELECT ${scope}, ${value} FROM ${table}
						WHERE ${id} IN (${valueList(chunk.map((each) => prunedKey(each)))})`
				)
				for (const row of rows) {
					const at = atOf(row.value)
					if (typeof row.scope === 'string' && at !== null) {
						found.set(row.scope, at)
					}
				}
			}
			return found
		},

		async recordPruned(of, before) {
			const recorded = atOf(await valueAt(prunedKey(of)))
			if (recorded !== null && recorded >= before) {
				return
			}
			await executor.execute(
				sql`INSERT INTO ${table} (${join([id, kind, scope, value])})
					VALUES (${prunedKey(of)}, ${'pruned'}, ${of}, ${json({ at: before.toISOString() })})
					ON CONFLICT (${id}) DO UPDATE SET ${value} = excluded.${value}`
			)
		},

		async lastZone(of) {
			const [row] = await executor.select(
				sql`SELECT ${tz} FROM ${table}
					WHERE ${kind} = ${'day'} AND ${scope} = ${of} AND ${aggregatedAt} IS NOT NULL
					ORDER BY ${day} DESC
					LIMIT 1`
			)
			return typeof row?.tz === 'string' ? row.tz : null
		},

		async scopes() {
			// One probe of the `(kind, scope, day)` index per scope, as the hits' scopes are found.
			const x = (name: string): SqlFragment => ident('x', name)
			const rows = await executor.select(
				sql`WITH RECURSIVE "s"("scope") AS (SELECT MIN(${scope}) FROM ${table} WHERE ${kind} = ${'day'}
					UNION ALL
					SELECT (SELECT MIN(${x('scope')}) FROM ${table} AS "x" WHERE ${x('kind')} = ${'day'} AND ${x('scope')} > ${ident('s', 'scope')})
						FROM "s" WHERE ${ident('s', 'scope')} IS NOT NULL)
				SELECT "scope" FROM "s" WHERE "scope" IS NOT NULL`,
				'long'
			)
			return rows
				.map((row) => row.scope)
				.filter((each): each is string => typeof each === 'string')
				.sort(compareCodePoints)
		},

		async noteDrop(note) {
			await executor.execute(
				sql`INSERT INTO ${table} (${join([id, kind, scope, day, gen])})
					VALUES (${dropKey(note)}, ${'drop'}, ${note.scope}, ${note.day}, ${note.gen})
					ON CONFLICT (${id}) DO NOTHING`
			)
		},

		async drops(limit) {
			checkStateLimit('drops', limit)
			const rows = await executor.select(
				sql`SELECT ${join([scope, day, gen])} FROM ${table} WHERE ${kind} = ${'drop'}
					ORDER BY ${day}, ${id} LIMIT ${limit}`
			)
			return rows.flatMap((row): DropNote[] => {
				const note = dropOf(row)
				return note ? [note] : []
			})
		},

		async clearDrop(note) {
			await executor.execute(sql`DELETE FROM ${table} WHERE ${id} = ${dropKey(note)}`)
		},

		async sweep(at) {
			const { rowCount } = await executor.execute(
				sql`DELETE FROM ${table} WHERE ${kind} = ${'salt'} AND ${expiresAt} <= ${at}`
			)
			return rowCount
		},

		async beat(task) {
			await executor.execute(
				sql`INSERT INTO ${table} (${join([id, kind, scope, value])})
					VALUES (${heartbeatKey(task)}, ${'heartbeat'}, ${''}, ${json({ at: now().toISOString() })})
					ON CONFLICT (${id}) DO UPDATE SET ${value} = excluded.${value}`
			)
		},

		async lastBeat(task) {
			return atOf(await valueAt(heartbeatKey(task)))
		},

		async cursor(task) {
			return cursorOf(await valueAt(cursorKey(task)))
		},

		async setCursor(task, cursor) {
			await executor.execute(
				sql`INSERT INTO ${table} (${join([id, kind, scope, value])})
					VALUES (${cursorKey(task)}, ${'cursor'}, ${''}, ${json({ cursor })})
					ON CONFLICT (${id}) DO UPDATE SET ${value} = excluded.${value}`
			)
		},

		async configToken(of) {
			return tokenOf(await valueAt(epochStateKey(of)))
		},

		async setConfigToken(of, token) {
			await executor.execute(
				sql`INSERT INTO ${table} (${join([id, kind, scope, value])})
					VALUES (${epochStateKey(of)}, ${'epoch'}, ${of}, ${json({ token })})
					ON CONFLICT (${id}) DO UPDATE SET ${value} = excluded.${value}`
			)
		},
	}
}
