import { describe, expect, it } from 'vitest'
import { AGGREGATION_VERSION, dayWindow } from '../aggregate'
import { DEFAULT_CAPS } from '../caps'
import { postgresDialect, type SqlDialect, sqliteDialect } from '../dialect'
import type { AggregateHooks } from '../types'
import type { DriverResult, TransactionOptions } from './drivers'
import type { SqlExecutor, SqlRow } from './executor'
import { compile, raw, type SqlFragment } from './fragment'
import { sqlEventStore } from './sqlStore'

const NOW = new Date('2026-10-08T12:00:00.000Z')
const WINDOW = dayWindow('s', 20261006, 'UTC')

interface Statement {
	text: string
	values: unknown[]
	/** Run inside the day's transaction. */
	inside: boolean
}

interface Script {
	/** The day's marker rows as the state table answers them. */
	markers?: SqlRow[]
	/** What the day's read answers. */
	day?: SqlRow[]
	/** What an aggregate read answers. */
	read?: SqlRow[]
	/** Rows a lease renewal changes: 1 while the run holds the lease. */
	renewed?: number
	/** The generations the day's rows carry before the run writes. */
	gens?: string[]
}

/** An executor answering the statements of a day's run from a script, recording each one. */
const scripted = (dialect: SqlDialect, script: Script) => {
	const statements: Statement[] = []
	const run = async (fragment: SqlFragment, inside: boolean): Promise<DriverResult> => {
		const { text, values } = compile(fragment, dialect)
		const flat = text.replace(/\s+/g, ' ').trim()
		statements.push({ text: flat, values, inside })
		if (flat.includes('AS "leaseOwner"')) {
			return { rows: script.markers ?? [], rowCount: 0 }
		}
		if (flat.startsWith('WITH h AS')) {
			return { rows: script.day ?? [], rowCount: 0 }
		}
		if (flat.startsWith('WITH m AS')) {
			return { rows: script.read ?? [], rowCount: 0 }
		}
		if (flat.startsWith('SELECT DISTINCT "gen"')) {
			return { rows: (script.gens ?? []).map((gen) => ({ gen })), rowCount: 0 }
		}
		if (flat.includes('SET "lease_until" =') && !flat.includes('"status"')) {
			return { rows: [], rowCount: script.renewed ?? 1 }
		}
		if (flat.startsWith('INSERT')) {
			return { rows: [], rowCount: (flat.match(/\), \(/g)?.length ?? 0) + 1 }
		}
		return { rows: [], rowCount: 1 }
	}
	const session = (inside: boolean) => ({
		dialect,
		select: async (fragment: SqlFragment) => (await run(fragment, inside)).rows,
		execute: (fragment: SqlFragment) => run(fragment, inside),
	})
	const transactions: TransactionOptions[] = []
	const executor: SqlExecutor = {
		...session(false),
		table: (slug) => raw(`"${slug.replace('-', '_')}"`),
		transaction: (work, options = {}) => {
			transactions.push(options)
			return work(session(true))
		},
		batch: async (statements, options = {}) => {
			transactions.push(options)
			const results: DriverResult[] = []
			for (const [index, { statement, expect: count }] of statements.entries()) {
				const result = await run(statement, true)
				results.push(result)
				if (count !== undefined && result.rowCount !== count) {
					return { committed: false, failedAt: index, results }
				}
			}
			return { committed: true, results }
		},
		blocking: async () => false,
		close: async () => undefined,
	}
	return { executor, statements, transactions }
}

const held = (owner: string, gen: string | null = null): SqlRow => ({
	scope: 's',
	day: 20261006,
	tz: 'UTC',
	status: 'open',
	version: null,
	gen,
	hits: null,
	leaseOwner: owner,
	leaseUntil: null,
	finalAfter: null,
	aggregatedAt: null,
})

const parts = (pageviews: number) => ({
	pageviews: String(pageviews),
	events: '0',
	visitors: '1',
	sessions: '1',
	entries: '1',
	bounces: '1',
	sessionMs: '0',
	durationMs: '0',
	scrollSum: '0',
	scrollSamples: '0',
	conversions: '0',
	revenue: '0',
	impressions: null,
	interactions: '0',
})

/** A day's read: the site row, `pages` page rows, and the hit count row. */
const dayOf = (pages: number): SqlRow[] => [
	{ k: 0, v1: '', v2: '', hostname: 'a.example', ...parts(pages) },
	...Array.from({ length: pages }, (_, i) => ({
		k: 16,
		v1: `/p${i}`,
		v2: '',
		hostname: 'a.example',
		...parts(1),
	})),
	{ k: -1, v1: '', v2: '', hostname: '', pageviews: String(pages + 3) },
]

const storeFor = (dialect: SqlDialect, script: Script, hooks?: AggregateHooks) => {
	const fake = scripted(dialect, script)
	return { ...fake, store: sqlEventStore(fake.executor, { now: () => NOW, hooks }) }
}

const RUN = { runId: 'run-1', caps: DEFAULT_CAPS, status: 'provisional' } as const

/** What each statement of a day's run is, by its text. */
const kindOf = (statement: Statement): string => {
	const { text } = statement
	if (text.startsWith('SELECT DISTINCT "gen"')) return 'gens'
	if (text.includes('AS "leaseOwner"')) return 'markers'
	if (text.startsWith('WITH h AS')) return 'read'
	if (text.includes('SET "lease_until" =') && !text.includes('"status"')) return 'renew'
	if (text.startsWith('INSERT') && text.includes("'drop'")) return 'note'
	if (text.startsWith('INSERT') && text.includes('"kind"')) return 'note'
	if (text.startsWith('INSERT')) return 'rows'
	if (text.startsWith('UPDATE')) return 'complete'
	if (text.startsWith('DELETE') && text.includes('"gen" IN')) return 'drop'
	if (text.startsWith('DELETE')) return 'clear note'
	return text.slice(0, 12)
}

describe('sqlEventStore.aggregateDay', () => {
	for (const dialect of [postgresDialect, sqliteDialect]) {
		it(`writes the day beside its readable rows, a statement per chunk, then completes it and drops the old rows, on ${dialect.name}`, async () => {
			const { store, statements, transactions } = storeFor(dialect, {
				markers: [held('run-1', 'G0')],
				day: dayOf(600),
				gens: ['G0'],
			})
			const result = await store.aggregateDay(WINDOW, RUN)
			expect(result).toEqual({ completed: true, hits: 603, rows: 601 })
			expect(statements.map(kindOf)).toEqual([
				'markers',
				'read',
				'renew',
				'markers',
				'gens',
				'note',
				'rows',
				'rows',
				'complete',
				'drop',
				'clear note',
			])
			const postgres = dialect.name === 'postgres'
			expect(statements.filter((statement) => statement.inside).map(kindOf)).toEqual(
				postgres ? ['read'] : []
			)
			expect(transactions).toEqual(postgres ? [{ analytical: true }] : [])
			const complete = statements.find((statement) => kindOf(statement) === 'complete')
			const gen = complete?.values[4]
			expect(typeof gen).toBe('string')
			expect(complete?.values.slice(0, 6)).toEqual([
				'provisional',
				'UTC',
				null,
				AGGREGATION_VERSION,
				gen,
				603,
			])
			const [rows] = statements.filter((statement) => kindOf(statement) === 'rows')
			expect(rows?.values[0]).toMatch(/^[A-Za-z0-9_-]{22}$/)
			expect(rows?.values[8]).toBe(gen)
			const drop = statements.find((statement) => kindOf(statement) === 'drop')
			expect(drop?.values.at(-1)).toBe('G0')
		})
	}

	it('writes nothing when the run holds no lease on the day', async () => {
		const { store, statements } = storeFor(postgresDialect, { markers: [held('someone-else')] })
		expect(await store.aggregateDay(WINDOW, RUN)).toEqual({ completed: false, hits: 0, rows: 0 })
		expect(statements).toHaveLength(1)
	})

	it('writes no row when the lease passed to another run before the write', async () => {
		const { store, statements } = storeFor(sqliteDialect, {
			markers: [held('run-1')],
			day: dayOf(3),
			renewed: 0,
		})
		expect(await store.aggregateDay(WINDOW, RUN)).toEqual({ completed: false, hits: 6, rows: 0 })
		expect(statements.some((statement) => kindOf(statement) === 'rows')).toBe(false)
	})

	it('drops what it wrote of a generation it could not complete, and throws', async () => {
		const { store, statements } = storeFor(
			postgresDialect,
			{ markers: [held('run-1')], day: dayOf(3) },
			{
				afterChunk: async () => {
					throw new Error('connection lost')
				},
			}
		)
		await expect(store.aggregateDay(WINDOW, RUN)).rejects.toThrow('connection lost')
		expect(statements.map(kindOf).slice(-4)).toEqual(['rows', 'markers', 'drop', 'clear note'])
	})

	it('caps the rows it writes, folding the tail into (other)', async () => {
		const { store, statements } = storeFor(postgresDialect, {
			markers: [held('run-1')],
			day: dayOf(5),
		})
		const result = await store.aggregateDay(WINDOW, {
			...RUN,
			caps: { ...DEFAULT_CAPS, page: 2 },
		})
		expect(result.rows).toBe(4)
		const insert = statements.find((statement) => kindOf(statement) === 'rows')
		expect(insert?.values.filter((value) => value === '/p0' || value === '/p1')).toHaveLength(2)
		expect(insert?.values.filter((value) => value === '/p4')).toHaveLength(0)
	})

	it('bounds a count a read started by its timeout, and no other count', async () => {
		const { store, transactions } = storeFor(postgresDialect, {
			markers: [held('run-1')],
			day: dayOf(3),
		})
		await store.aggregateDay(WINDOW, { ...RUN, timeoutMs: 8_000 })
		await store.aggregateDay(WINDOW, RUN)
		expect(transactions).toEqual([{ analytical: true, timeoutMs: 8_000 }, { analytical: true }])
		await expect(store.aggregateDay(WINDOW, { ...RUN, timeoutMs: 0 })).rejects.toThrow(/timeout/)
	})
})

describe('sqlEventStore.readAggregates', () => {
	const read = {
		scope: 's',
		days: [[20261001, 20261007]] as const,
		dim: 'page' as const,
		groupBy: 'value' as const,
	}

	it('turns the summed columns into parts, keeping null where no row knew a part', async () => {
		const { store } = storeFor(postgresDialect, {
			read: [
				{ value: '', ...parts(7), visitors: null, sessions: null, sessionMs: null, n: '3' },
				{ value: '/a', ...parts(4), n: '2' },
			],
		})
		expect(await store.readAggregates(read)).toEqual([
			{
				value: '',
				parts: expect.objectContaining({ pageviews: 7, visitors: null, impressions: null }),
			},
			{ value: '/a', parts: expect.objectContaining({ pageviews: 4, visitors: 1 }) },
		])
	})

	it('answers zeros for a total with no completed row, and nothing for an empty fill', async () => {
		const { store, statements } = storeFor(sqliteDialect, {
			read: [{ ...parts(0), pageviews: null, events: null, n: 0 }],
		})
		const [total] = await store.readAggregates({ ...read, groupBy: 'total' })
		expect(total?.parts).toMatchObject({ pageviews: 0, sessions: 0, impressions: null })
		expect(await store.readAggregates({ ...read, values: [] })).toEqual([])
		expect(statements).toHaveLength(1)
	})

	it('reads a day series by day', async () => {
		const { store } = storeFor(postgresDialect, {
			read: [{ day: '20261002', ...parts(2), n: 1 }],
		})
		expect(await store.readAggregates({ ...read, dim: '', groupBy: 'day' })).toEqual([
			{ value: null, day: 20261002, parts: expect.objectContaining({ pageviews: 2 }) },
		])
	})
})
