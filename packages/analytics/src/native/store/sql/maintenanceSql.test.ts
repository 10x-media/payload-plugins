import { describe, expect, it } from 'vitest'
import { recordingExecutor } from '../../../testing/recordingExecutor'
import { postgresDialect, type SqlDialect, sqliteDialect } from '../dialect'
import { type SqlRow, tableKeyOf } from './executor'
import { raw } from './fragment'
import { DAY_DELETE_CHUNK, sqlEventStore } from './sqlStore'

/** An executor recording each statement: a select answers `rows`, a write `rowCount`. */
const fakeExecutor = (dialect: SqlDialect, answer: { rows?: SqlRow[]; rowCount?: number } = {}) =>
	recordingExecutor(dialect, {
		table: (slug) => raw(`"${tableKeyOf(slug)}"`),
		answer: () => ({ rows: answer.rows ?? [], rowCount: answer.rowCount ?? 0 }),
	})

const BEFORE = new Date('2026-07-10T00:00:00.000Z')

describe('sqlEventStore upkeep statements', () => {
	it('prunes a bounded chunk of a scope’s hits by id, answering the rows it deleted', async () => {
		const { executor, statements } = fakeExecutor(postgresDialect, { rowCount: 5000 })
		const store = sqlEventStore(executor)
		expect(await store.pruneHits({ scope: 's', before: BEFORE, limit: 5000 })).toBe(5000)
		expect(statements).toEqual([
			{
				text: `DELETE FROM "analytics_hits" WHERE "id" IN (SELECT "id" FROM "analytics_hits" WHERE "scope" = $1 AND "ts" < $2 AND substr("id", 1, 1) <> 'o' LIMIT $3)`,
				values: ['s', '2026-07-10T00:00:00.000Z', 5000],
			},
		])
		await expect(store.pruneHits({ scope: 's', before: BEFORE, limit: 0 })).rejects.toThrow(
			/whole size/
		)
	})

	it("turns an order's record into its tombstone once the rest of a chunk is deleted, from where the last prune stopped", async () => {
		const { executor, statements } = fakeExecutor(sqliteDialect, { rowCount: 3 })
		const from = new Date('2026-07-09T00:00:00.000Z')
		expect(
			await sqlEventStore(executor).pruneHits({ scope: 's', from, before: BEFORE, limit: 10 })
		).toBe(6)
		expect(statements.map((statement) => statement.values)).toEqual([
			['s', '2026-07-09T00:00:00.000Z', '2026-07-10T00:00:00.000Z', 10],
			['s', '2026-07-09T00:00:00.000Z', '2026-07-10T00:00:00.000Z', 7],
		])
		const tombstone = statements[1]?.text ?? ''
		expect(tombstone).toMatch(
			/^UPDATE "analytics_hits" SET "v" = '', "last_at" = NULL, "ref" = NULL/
		)
		expect(tombstone).toContain('"props" = NULL')
		expect(tombstone).toContain(`substr("id", 1, 1) = 'o' AND ("v" <> '' OR "last_at" IS NOT NULL`)
	})

	it('deletes order records past their days’ totals', async () => {
		const { executor, statements } = fakeExecutor(postgresDialect, { rowCount: 2 })
		expect(
			await sqlEventStore(executor).expireOrders({ scope: 's', before: BEFORE, limit: 5000 })
		).toBe(2)
		expect(statements).toEqual([
			{
				text: `DELETE FROM "analytics_hits" WHERE "id" IN (SELECT "id" FROM "analytics_hits" WHERE "scope" = $1 AND "ts" < $2 AND substr("id", 1, 1) = 'o' LIMIT $3)`,
				values: ['s', '2026-07-10T00:00:00.000Z', 5000],
			},
		])
	})

	it('prunes a scope’s daily totals of earlier days the same way, on SQLite', async () => {
		const { executor, statements } = fakeExecutor(sqliteDialect, { rowCount: 3 })
		expect(
			await sqlEventStore(executor).pruneAggregates({
				scope: 's',
				beforeDay: 20260710,
				limit: 5000,
			})
		).toBe(3)
		expect(statements).toEqual([
			{
				text: 'DELETE FROM "analytics_aggregates" WHERE "id" IN (SELECT "id" FROM "analytics_aggregates" WHERE "scope" = ? AND "day" < ? LIMIT ?)',
				values: ['s', 20260710, 5000],
			},
		])
	})

	it('reads a scope’s oldest hit off its index, a date from either driver', async () => {
		const pg = fakeExecutor(postgresDialect, {
			rows: [{ ts: new Date('2026-07-01T08:00:00.000Z') }],
		})
		expect(await sqlEventStore(pg.executor).oldestHit('s')).toEqual(
			new Date('2026-07-01T08:00:00.000Z')
		)
		expect(pg.statements[0]).toEqual({
			text: 'SELECT MIN("ts") AS "ts" FROM "analytics_hits" WHERE "scope" = $1',
			values: ['s'],
		})
		const lite = fakeExecutor(sqliteDialect, { rows: [{ ts: '2026-07-01T08:00:00.000Z' }] })
		expect(await sqlEventStore(lite.executor).oldestHit('s')).toEqual(
			new Date('2026-07-01T08:00:00.000Z')
		)
		const none = fakeExecutor(sqliteDialect, { rows: [{ ts: null }] })
		expect(await sqlEventStore(none.executor).oldestHit('s')).toBeNull()
	})

	it('sweeps a day’s rows of every generation but the one its marker names, a share at a time', async () => {
		const { executor, statements } = fakeExecutor(postgresDialect, { rowCount: 7 })
		expect(
			await sqlEventStore(executor).sweepGenerations({ scope: 's', day: 20261005 }, 'G2')
		).toBe(7)
		expect(statements[0]?.text).toMatch(
			/^DELETE FROM "analytics_aggregates" WHERE "id" IN \(SELECT "id" FROM "analytics_aggregates" WHERE "scope" = \$1 AND "day" = \$2 AND "dim" IN \(.*\) AND "dim2" IN \(.*\) AND "gen" <> \$\d+ LIMIT 2000\)$/
		)
		expect(statements[0]?.values.at(-1)).toBe('G2')
		const { executor: busy, statements: shares } = fakeExecutor(postgresDialect, {
			rowCount: DAY_DELETE_CHUNK,
		})
		let left = 3
		const answering = {
			...busy,
			execute: async (fragment: Parameters<typeof busy.execute>[0]) => {
				const result = await busy.execute(fragment)
				left -= 1
				return left > 0 ? result : { ...result, rowCount: 5 }
			},
		}
		expect(
			await sqlEventStore(answering).sweepGenerations({ scope: 's', day: 20261005 }, 'G2')
		).toBe(2 * DAY_DELETE_CHUNK + 5)
		expect(shares).toHaveLength(3)
	})
})

describe('sqlEventStore.reclassify', () => {
	const run = {
		scope: 's',
		start: new Date('2026-10-05T00:00:00.000Z'),
		end: new Date('2026-10-06T06:00:00.000Z'),
		version: 2,
		classify: (tuple: { ref: string | null }) => (tuple.ref ? 'organic-search' : 'direct'),
	}

	it('matches each tuple null-safely, IS NOT DISTINCT FROM on Postgres, one day at a time', async () => {
		const { executor, statements } = fakeExecutor(postgresDialect, {
			rows: [
				{ ref: 'google.com', utmSource: null, utmMedium: null, clickId: null },
				{ ref: null, utmSource: null, utmMedium: null, clickId: null },
			],
			rowCount: 4,
		})
		expect(await sqlEventStore(executor).reclassify(run)).toBe(16)
		expect(statements[0]).toEqual({
			text: 'SELECT DISTINCT "ref" AS "ref", "utm_source" AS "utmSource", "utm_medium" AS "utmMedium", "click_id" AS "clickId" FROM "analytics_hits" WHERE "scope" = $1 AND "ts" >= $2 AND "ts" < $3 AND "channel_version" < $4',
			values: ['s', '2026-10-05T00:00:00.000Z', '2026-10-06T06:00:00.000Z', 2],
		})
		expect(statements.slice(1)).toHaveLength(4)
		expect(statements[1]).toEqual({
			text: 'UPDATE "analytics_hits" SET "channel" = $1, "channel_version" = $2 WHERE "scope" = $3 AND "ts" >= $4 AND "ts" < $5 AND "channel_version" < $6 AND (("ref" IS NOT DISTINCT FROM $7 AND "utm_source" IS NOT DISTINCT FROM $8 AND "utm_medium" IS NOT DISTINCT FROM $9 AND "click_id" IS NOT DISTINCT FROM $10))',
			values: [
				'organic-search',
				2,
				's',
				'2026-10-05T00:00:00.000Z',
				'2026-10-06T00:00:00.000Z',
				2,
				'google.com',
				null,
				null,
				null,
			],
		})
		expect(statements[4]?.values.slice(3, 5)).toEqual([
			'2026-10-06T00:00:00.000Z',
			'2026-10-06T06:00:00.000Z',
		])
	})

	it('matches with IS on SQLite, the tuples of one channel in one statement', async () => {
		const { executor, statements } = fakeExecutor(sqliteDialect, {
			rows: [
				{ ref: 'google.com', utmSource: null, utmMedium: null, clickId: null },
				{ ref: 'bing.com', utmSource: null, utmMedium: null, clickId: 'gclid' },
			],
			rowCount: 1,
		})
		await sqlEventStore(executor).reclassify({ ...run, end: new Date('2026-10-05T12:00:00.000Z') })
		expect(statements).toHaveLength(2)
		expect(statements[1]?.text).toContain(
			'AND (("ref" IS ? AND "utm_source" IS ? AND "utm_medium" IS ? AND "click_id" IS ?) OR ("ref" IS ? AND "utm_source" IS ? AND "utm_medium" IS ? AND "click_id" IS ?))'
		)
	})

	it('updates nothing when no hit is of an older taxonomy', async () => {
		const { executor, statements } = fakeExecutor(postgresDialect)
		expect(await sqlEventStore(executor).reclassify(run)).toBe(0)
		expect(statements).toHaveLength(1)
	})
})
