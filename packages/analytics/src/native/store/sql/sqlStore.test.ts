import type { Field } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { UnsupportedFilterError } from '../../../core/sourceErrors'
import { type RecordedStatement, recordingExecutor } from '../../../testing/recordingExecutor'
import { hitsCollection } from '../../collections/hits'
import { postgresDialect, type SqlDialect, sqliteDialect } from '../dialect'
import { ReadTimeoutError } from '../rawRead'
import type { HitRow, RawRead } from '../types'
import type { TransactionOptions } from './drivers'
import { type SqlExecutor, type SqlRow, tableKeyOf } from './executor'
import { compile, raw } from './fragment'
import { PoolWaitTimeoutError } from './poolShare'
import { MAIN_THREAD_STALL_MS } from './sqliteThread'
import { SQLITE_HITS_PER_MS, sqlEventStore } from './sqlStore'

/** An executor recording each statement compiled for its dialect; `written` gives its row count. */
const fakeExecutor = (dialect: SqlDialect, written: (rows: number) => number = (rows) => rows) =>
	recordingExecutor(dialect, {
		table: () => raw(dialect.name === 'postgres' ? '"stats"."analytics_hits"' : '"analytics_hits"'),
		answer: (text) => ({ rowCount: written((text.match(/\), \(/g)?.length ?? 0) + 1) }),
	})

const TS = new Date('2026-10-06T10:00:00.000Z')

const hit = (id: string, overrides: Partial<HitRow> = {}): HitRow => ({
	id,
	scope: '',
	ts: TS,
	type: 'pageview',
	hostname: 'a.example',
	path: '/',
	v: 'AAAAAAAAAAAAAAAA',
	landing: true,
	server: false,
	...overrides,
})

const COLUMNS =
	'"id", "scope", "ts", "last_at", "type", "hostname", "path", "v", "landing", "server", "mode", "name", "ref", "source", "channel", "channel_version", "click_id", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "country", "region", "city", "language", "device", "browser", "os", "duration_ms", "scroll_depth", "value", "original_value", "conversions", "revenue", "currency", "original_currency", "item", "props", "goals", "impressions"'

/** The rest of a row whose optional fields are all absent: one NULL per column after `server`. */
const NULLS = Array.from({ length: 31 }, () => 'NULL').join(', ')

describe('sqlEventStore.append', () => {
	it('writes a hit in one INSERT that leaves an id already stored alone, on Postgres', async () => {
		const { executor, statements } = fakeExecutor(postgresDialect)
		const result = await sqlEventStore(executor).append([hit('01A')])
		expect(result).toEqual({ written: 1, duplicates: 0 })
		expect(statements).toEqual([
			{
				text: `INSERT INTO "stats"."analytics_hits" (${COLUMNS}) VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, $8, $9, ${NULLS}) ON CONFLICT ("id") DO NOTHING`,
				values: [
					'01A',
					'',
					'2026-10-06T10:00:00.000Z',
					'pageview',
					'a.example',
					'/',
					'AAAAAAAAAAAAAAAA',
					true,
					false,
				],
			},
		])
	})

	it('binds dates as ISO text, flags as 1 and 0, and JSON as its text, on SQLite', async () => {
		const { executor, statements } = fakeExecutor(sqliteDialect)
		await sqlEventStore(executor).append([
			hit('01B', {
				type: 'engagement',
				lastAt: new Date('2026-10-06T10:05:00.000Z'),
				landing: false,
				durationMs: 4000,
				impressions: ['offers:1'],
			}),
		])
		const [statement] = statements
		expect(statement?.text).toMatch(
			/^INSERT INTO "analytics_hits" \(.+\) VALUES \(\?, \?, \?, \?, \?, .+\) ON CONFLICT \("id"\) DO NOTHING$/
		)
		expect(statement?.values).toEqual([
			'01B',
			'',
			'2026-10-06T10:00:00.000Z',
			'2026-10-06T10:05:00.000Z',
			'engagement',
			'a.example',
			'/',
			'AAAAAAAAAAAAAAAA',
			0,
			0,
			4000,
			'["offers:1"]',
		])
	})

	it('binds JSON as jsonb on Postgres, and every field it carries in its own column', async () => {
		const { executor, statements } = fakeExecutor(postgresDialect)
		const full: HitRow = hit('01C', {
			scope: 'tenant',
			type: 'goal',
			landing: false,
			server: true,
			mode: 'c',
			name: 'purchase',
			ref: 'google.com',
			source: 'google.com',
			channel: 'organic-search',
			channelVersion: 1,
			clickId: 'gclid',
			utmSource: 's',
			utmMedium: 'm',
			utmCampaign: 'c',
			utmContent: 'ct',
			utmTerm: 't',
			country: 'DE',
			region: 'BE',
			city: 'Berlin',
			language: 'de-de',
			device: 'desktop',
			browser: 'chrome',
			os: 'macos',
			durationMs: 1,
			scrollDepth: 2,
			value: 49,
			originalValue: 50,
			conversions: 1,
			revenue: 49,
			currency: 'EUR',
			originalCurrency: 'USD',
			item: 'offers:1',
			props: { plan: 'pro' },
			goals: [{ slug: 'purchase', value: 49 }],
			impressions: ['offers:2'],
		})
		await sqlEventStore(executor).append([full])
		const [statement] = statements
		// A goal has no reading time to end: its one absent column.
		expect(statement?.text.match(/NULL/g)).toEqual(['NULL'])
		expect(statement?.text).toContain('$38::jsonb, $39::jsonb, $40::jsonb)')
		expect(statement?.values.slice(-3)).toEqual([
			'{"plan":"pro"}',
			'[{"slug":"purchase","value":49}]',
			'["offers:2"]',
		])
		expect(statement?.values).toHaveLength(40)
	})

	it('names a column for every field of the hits collection, as Payload names them', () => {
		const fields = hitsCollection().fields.flatMap((field: Field) =>
			'name' in field ? [tableKeyOf(field.name)] : []
		)
		const columns = COLUMNS.split(', ').map((column) => column.replaceAll('"', ''))
		expect([...columns].sort()).toEqual([...fields].sort())
	})

	it('writes past 500 hits in chunks of 500, one statement each, all in one batch', async () => {
		const { executor, statements } = fakeExecutor(sqliteDialect)
		const batch = vi.spyOn(executor, 'batch')
		const hits = Array.from({ length: 1234 }, (_, i) => hit(`H${String(i).padStart(5, '0')}`))
		expect(await sqlEventStore(executor).append(hits)).toEqual({ written: 1234, duplicates: 0 })
		expect(batch).toHaveBeenCalledTimes(1)
		expect(statements.map((statement) => statement.values[0])).toEqual([
			'H00000',
			'H00500',
			'H01000',
		])
		expect(statements.map((statement) => statement.values.length)).toEqual([
			500 * 9,
			500 * 9,
			234 * 9,
		])
	})

	it('counts what the table already held as duplicates, from the rows the statement wrote', async () => {
		const { executor } = fakeExecutor(postgresDialect, (rows) => rows - 2)
		expect(await sqlEventStore(executor).append([hit('A'), hit('B'), hit('C')])).toEqual({
			written: 1,
			duplicates: 2,
		})
	})

	it('writes an id repeated within one call once, and counts the repeat as a duplicate', async () => {
		const { executor, statements } = fakeExecutor(sqliteDialect)
		const result = await sqlEventStore(executor).append([
			hit('A'),
			hit('B'),
			hit('A', { path: '/again' }),
		])
		expect(result).toEqual({ written: 2, duplicates: 1 })
		expect(statements[0]?.values).not.toContain('/again')
	})

	it('runs nothing for no hits, and reads nothing for any', async () => {
		const { executor, statements } = fakeExecutor(postgresDialect)
		const store = sqlEventStore(executor)
		expect(await store.append([])).toEqual({ written: 0, duplicates: 0 })
		expect(statements).toEqual([])
		await store.append([hit('A'), hit('B')])
		expect(statements.every((statement) => statement.text.startsWith('INSERT INTO'))).toBe(true)
	})

	it('names itself after its dialect', () => {
		expect(sqlEventStore(fakeExecutor(postgresDialect).executor)).toMatchObject({
			id: 'postgres',
			features: { aggregates: true, rawAnyRange: false },
		})
		expect(sqlEventStore(fakeExecutor(sqliteDialect).executor).id).toBe('sqlite')
	})
})

/** An executor answering each select with `answer`, recording selects and transactions. */
const readExecutor = (
	dialect: SqlDialect,
	answer: (text: string) => SqlRow[] | Error,
	blocking = false
) => {
	const selects: RecordedStatement[] = []
	const signals: Array<AbortSignal | undefined> = []
	const transactions: TransactionOptions[] = []
	const executor: SqlExecutor = {
		dialect,
		select: async (fragment, _kind, signal) => {
			const { text, values } = compile(fragment, dialect)
			const flat = text.replace(/\s+/g, ' ').trim()
			selects.push({ text: flat, values })
			signals.push(signal)
			const rows = answer(flat)
			if (rows instanceof Error) {
				throw rows
			}
			return rows
		},
		execute: async () => ({ rows: [], rowCount: 0 }),
		table: () => raw('"analytics_hits"'),
		transaction: async (work, options = {}) => {
			transactions.push(options)
			return work(executor)
		},
		batch: async (statements) => ({
			committed: true,
			results: statements.map(() => ({ rows: [], rowCount: 0 })),
		}),
		blocking: async () => blocking,
		close: async () => undefined,
	}
	return { executor, selects, signals, transactions }
}

const DAY = new Date('2026-10-06T00:00:00.000Z')
const NEXT = new Date('2026-10-07T00:00:00.000Z')
const pages: RawRead = {
	scope: 's',
	start: DAY,
	end: NEXT,
	filters: [],
	groupBy: 'page',
	buckets: [DAY],
	sessions: false,
	timeoutMs: 2000,
}

describe('sqlEventStore reads', () => {
	it('reads on Postgres in an analytical transaction bounded by the read time, numbers out of their text', async () => {
		const { executor, selects, transactions } = readExecutor(postgresDialect, () => [
			{ value: '/a', bucket: 0, pageviews: '3', events: '1', visitors: '2', revenue: '12.25' },
		])
		const rows = await sqlEventStore(executor).readRaw(pages)
		expect(transactions).toEqual([{ analytical: true, timeoutMs: 2000 }])
		expect(selects).toHaveLength(1)
		expect(rows).toEqual([
			{
				value: '/a',
				bucket: 0,
				parts: expect.objectContaining({
					pageviews: 3,
					events: 1,
					visitors: 2,
					revenue: 12.25,
					conversions: 0,
					sessions: null,
					impressions: null,
				}),
			},
		])
	})

	it("turns Postgres' statement timeout into a ReadTimeoutError", async () => {
		const canceled = Object.assign(new Error('canceling statement due to statement timeout'), {
			code: '57014',
		})
		const { executor } = readExecutor(postgresDialect, () => canceled)
		const failure = sqlEventStore(executor).readRaw(pages)
		await expect(failure).rejects.toBeInstanceOf(ReadTimeoutError)
		await expect(failure).rejects.toMatchObject({ timeoutMs: 2000, cause: canceled })
	})

	it('hands a Postgres read its signal, and a wait for a connection past its time is a timeout', async () => {
		const { signal } = new AbortController()
		const waited = new PoolWaitTimeoutError(2000)
		const { executor, transactions } = readExecutor(postgresDialect, () => waited)
		const failure = sqlEventStore(executor).readRaw({ ...pages, signal })
		await expect(failure).rejects.toBeInstanceOf(ReadTimeoutError)
		await expect(failure).rejects.toMatchObject({ timeoutMs: 2000, cause: waited })
		expect(transactions).toEqual([{ analytical: true, timeoutMs: 2000, signal }])
	})

	it('hands an aggregate read its signal, so a read that gave up drops it while it waits', async () => {
		const { signal } = new AbortController()
		const { executor, signals } = readExecutor(postgresDialect, () => [])
		await sqlEventStore(executor).readAggregates({
			scope: 's',
			days: [[20261001, 20261007]],
			dim: '',
			groupBy: 'total',
			signal,
		})
		expect(signals).toEqual([signal])
	})

	it('counts the window off the index on SQLite before reading it, outside any transaction', async () => {
		const { executor, selects, transactions } = readExecutor(sqliteDialect, (text) =>
			text.startsWith('SELECT COUNT(*)') ? [{ n: 10 }] : []
		)
		expect(await sqlEventStore(executor).readRaw(pages)).toEqual([])
		expect(transactions).toEqual([])
		const budget = 2000 * SQLITE_HITS_PER_MS.plain
		expect(selects[0]).toEqual({
			text: 'SELECT COUNT(*) AS "n" FROM (SELECT 1 FROM "analytics_hits" WHERE "scope" = ? AND "ts" >= ? AND "ts" < ? LIMIT ?) AS "c"',
			values: ['s', DAY.toISOString(), NEXT.toISOString(), budget + 1],
		})
		expect(selects).toHaveLength(2)
		await sqlEventStore(executor).readRaw({ ...pages, sessions: true })
		expect(selects[2]?.values.at(-1)).toBe(2000 * SQLITE_HITS_PER_MS.visits + 1)
	})

	it('on the main thread, refuses a read that would hold it past the stall bound, and says so', async () => {
		const { executor, selects } = readExecutor(
			sqliteDialect,
			() => [{ n: MAIN_THREAD_STALL_MS * SQLITE_HITS_PER_MS.plain + 1 }],
			true
		)
		const store = sqlEventStore(executor)
		expect(await store.blockingBudgetMs?.()).toBe(MAIN_THREAD_STALL_MS)
		const failure = store.readRaw(pages)
		await expect(failure).rejects.toMatchObject({ timeoutMs: MAIN_THREAD_STALL_MS })
		expect(selects[0]?.values.at(-1)).toBe(MAIN_THREAD_STALL_MS * SQLITE_HITS_PER_MS.plain + 1)
		expect(selects).toHaveLength(1)
		expect(
			await sqlEventStore(readExecutor(sqliteDialect, () => []).executor).blockingBudgetMs?.()
		).toBeNull()
	})

	it('refuses a SQLite read with more hits than its time allows, before running it', async () => {
		const { executor, selects } = readExecutor(sqliteDialect, () => [
			{ n: 2000 * SQLITE_HITS_PER_MS.plain + 1 },
		])
		await expect(sqlEventStore(executor).readRaw(pages)).rejects.toBeInstanceOf(ReadTimeoutError)
		expect(selects).toHaveLength(1)
	})

	it('filters with regular expressions on Postgres alone', async () => {
		const regex: RawRead = {
			...pages,
			filters: [{ dimension: 'page', operator: 'matches', value: '^/' }],
		}
		const lite = sqlEventStore(readExecutor(sqliteDialect, () => []).executor)
		expect(lite.features.filters.page).toEqual(['eq', 'contains'])
		await expect(lite.readRaw(regex)).rejects.toBeInstanceOf(UnsupportedFilterError)
		const pg = sqlEventStore(readExecutor(postgresDialect, () => []).executor)
		expect(pg.features.filters.page).toEqual(['eq', 'contains', 'matches'])
		expect(await pg.readRaw(regex)).toEqual([])
	})

	it('runs nothing for an exact fill of no values', async () => {
		const { executor, selects } = readExecutor(sqliteDialect, () => [])
		expect(await sqlEventStore(executor).readRaw({ ...pages, values: [] })).toEqual([])
		expect(selects).toEqual([])
	})

	it('answers whether a window has a hit, and its scopes in code point order', async () => {
		const { executor } = readExecutor(postgresDialect, (text) =>
			text.startsWith('WITH RECURSIVE')
				? [{ scope: 'b' }, { scope: '' }, { scope: 'B' }]
				: [{ hit: 1 }]
		)
		const store = sqlEventStore(executor)
		expect(await store.hasHits({ scope: 's', start: DAY, end: NEXT })).toBe(true)
		expect(await store.scopes()).toEqual(['', 'B', 'b'])
		const empty = sqlEventStore(readExecutor(postgresDialect, () => []).executor)
		expect(await empty.hasHits({ scope: 's', start: DAY, end: NEXT })).toBe(false)
	})

	it('reads one hit by its primary key, as a hit from either driver', async () => {
		const goals = [{ slug: 'purchase', value: 250, sent: 260 }]
		for (const [dialect, row] of [
			[
				postgresDialect,
				{ ts: DAY, landing: false, server: true, goals, original_currency: 'CHF', props: null },
			],
			[
				sqliteDialect,
				{
					ts: DAY.toISOString(),
					landing: 0,
					server: 1,
					goals: JSON.stringify(goals),
					original_currency: 'CHF',
					props: null,
				},
			],
		] as const) {
			const { executor, selects } = readExecutor(dialect, () => [
				{
					id: 'os.abc',
					scope: 's',
					type: 'goal',
					hostname: 'h',
					path: '/orders',
					v: '',
					...row,
				},
			])
			expect(await sqlEventStore(executor).hitById('os.abc')).toEqual({
				id: 'os.abc',
				scope: 's',
				ts: DAY,
				type: 'goal',
				hostname: 'h',
				path: '/orders',
				v: '',
				landing: false,
				server: true,
				originalCurrency: 'CHF',
				goals,
			})
			expect(selects).toEqual([
				{
					text: `SELECT * FROM "analytics_hits" WHERE "id" = ${dialect.placeholder(1)}`,
					values: ['os.abc'],
				},
			])
		}
		const none = sqlEventStore(readExecutor(sqliteDialect, () => []).executor)
		expect(await none.hitById('os.none')).toBeNull()
	})
})
