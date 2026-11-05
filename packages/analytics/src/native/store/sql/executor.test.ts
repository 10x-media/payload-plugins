import type { Payload } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { numberOf } from '../columnValues'
import { postgresDialect, sqliteDialect } from '../dialect'
import { createSqlExecutor, tableKeyOf, transactionSettings } from './executor'
import { compile, sql } from './fragment'
import type { OwnConnectionDeps } from './ownConnection'

/** A pg pool recording what it was asked, answering one row. */
const pool = (name: string) => {
	const seen: Array<{ text: string; values: readonly unknown[] }> = []
	return {
		seen,
		query: async (text: string, values: readonly unknown[]) => {
			seen.push({ text: `${name}: ${text}`, values })
			return { rows: [{ total: '7' }], rowCount: 1 }
		},
		connect: async () => ({
			query: async () => ({ rows: [], rowCount: 0 }),
			release: () => undefined,
		}),
	}
}

/** A libsql client on `/x.db` recording what it was asked, `name` before each statement. */
const libsqlClient = (seen: string[], name: string) => ({
	protocol: 'file',
	batch: async (statements: Array<{ sql: string }>) => {
		seen.push(`${name}BATCH ${statements.map((statement) => statement.sql).join('; ')}`)
		return statements.map(() => ({ rows: [], rowsAffected: 1 }))
	},
	execute: async (statement: string | { sql: string }) => {
		const text = typeof statement === 'string' ? statement : statement.sql
		seen.push(`${name}${text}`)
		return text === 'PRAGMA database_list'
			? { rows: [{ name: 'main', file: '/x.db' }], rowsAffected: 0 }
			: { rows: [{ total: 7 }], rowsAffected: 1 }
	},
	transaction: async () => ({
		execute: async () => ({ rows: [], rowsAffected: 0 }),
		commit: async () => undefined,
		rollback: async () => undefined,
		close: () => undefined,
	}),
	close: () => undefined,
})

/** The adapter's client, and how the engine opens its own beside it: one recording as `own: `. */
const libsql = () => {
	const seen: string[] = []
	const own = libsqlClient(seen, 'own: ')
	const ownConnections: OwnConnectionDeps = {
		resolveClient: () => ({ path: '/fake/@libsql/client' }),
		load: () => ({ createClient: () => own }),
		natives: () => ['/fake/libsql.node'],
	}
	return { seen, ownConnections, ...libsqlClient(seen, '') }
}

const fakePayload = (db: Record<string, unknown>): Payload => ({ db }) as unknown as Payload

const tables = new Map([
	['analytics_hits', 'analytics_hits'],
	['analytics_state', 'a_state'],
])

describe('createSqlExecutor on Postgres', () => {
	it('runs on the adapter’s own pool, with numbered placeholders', async () => {
		const own = pool('own')
		const executor = createSqlExecutor(
			fakePayload({
				name: 'postgres',
				pool: own,
				drizzle: { $client: pool('drizzle') },
				tableNameMap: tables,
			})
		)
		const rows = await executor.select(
			sql`SELECT count(*) AS total FROM ${executor.table('analytics-hits')} WHERE scope = ${'a'}`
		)
		expect(own.seen).toEqual([
			{
				text: 'own: SELECT count(*) AS total FROM "analytics_hits" WHERE scope = $1',
				values: ['a'],
			},
		])
		expect(numberOf(rows[0]?.total)).toBe(7)
		expect(executor.dialect.name).toBe('postgres')
	})

	it('takes drizzle’s client where the adapter keeps no pool of its own (Vercel)', async () => {
		const drizzleClient = pool('drizzle')
		const executor = createSqlExecutor(
			fakePayload({ name: 'postgres', drizzle: { $client: drizzleClient }, tableNameMap: tables })
		)
		await executor.execute(sql`DELETE FROM t WHERE id = ${1}`)
		expect(drizzleClient.seen[0]?.text).toBe('drizzle: DELETE FROM t WHERE id = $1')
	})

	it('names a table by the adapter’s own map, inside its schema', () => {
		const executor = createSqlExecutor(
			fakePayload({
				name: 'postgres',
				pool: pool('own'),
				tableNameMap: tables,
				schemaName: 'stats',
			})
		)
		expect(compile(executor.table('analytics-state'), executor.dialect).text).toBe(
			'"stats"."a_state"'
		)
		expect(() => executor.table('analytics-nothing')).toThrow(
			/no table for the "analytics-nothing"/
		)
	})

	it('refuses an adapter holding no driver it can run SQL on', () => {
		expect(() => createSqlExecutor(fakePayload({ name: 'postgres', drizzle: {} }))).toThrow(
			/no postgres driver client/
		)
	})
})

describe('createSqlExecutor on SQLite', () => {
	it('runs on a connection of its own beside the adapter’s, with ? placeholders and its busy timeout', async () => {
		const client = libsql()
		const executor = createSqlExecutor(
			fakePayload({ name: 'sqlite', client, busyTimeout: 8000, tableNameMap: tables }),
			{ ownConnections: client.ownConnections }
		)
		await executor.execute(sql`DELETE FROM ${executor.table('analytics-hits')} WHERE id = ${'x'}`)
		expect(client.seen).toEqual([
			'PRAGMA database_list',
			'own: PRAGMA database_list',
			'own: PRAGMA busy_timeout = 8000',
			'own: DELETE FROM "analytics_hits" WHERE id = ?',
		])
	})

	it('waits five seconds for a lock when the adapter set no busy timeout', async () => {
		const client = libsql()
		await createSqlExecutor(fakePayload({ name: 'sqlite', client, busyTimeout: 0 }), {
			ownConnections: client.ownConnections,
		}).execute(sql`DELETE FROM t`)
		expect(client.seen).toContain('own: PRAGMA busy_timeout = 5000')
	})

	it('takes a busy timeout of its own over the adapter’s', async () => {
		const client = libsql()
		await createSqlExecutor(fakePayload({ name: 'sqlite', client, busyTimeout: 8000 }), {
			busyTimeoutMs: 250,
			ownConnections: client.ownConnections,
		}).execute(sql`DELETE FROM t`)
		expect(client.seen).toContain('own: PRAGMA busy_timeout = 250')
	})

	it('stays on the main thread when asked to, its statements then blocking', async () => {
		const client = libsql()
		const executor = createSqlExecutor(
			fakePayload({ name: 'sqlite', client, clientConfig: { url: 'file:/x.db' } }),
			{ thread: 'main', ownConnections: client.ownConnections }
		)
		expect(await executor.blocking()).toBe(true)
		await executor.batch([{ statement: sql`DELETE FROM a` }, { statement: sql`DELETE FROM b` }])
		expect(client.seen).toEqual([
			'PRAGMA database_list',
			'own: PRAGMA database_list',
			'own: PRAGMA busy_timeout = 5000',
			'own: BATCH DELETE FROM a; DELETE FROM b',
		])
	})

	it('fails every statement loudly on a database it can open no connection of its own to', async () => {
		const client = { ...libsql(), execute: async () => ({ rows: [], rowsAffected: 0 }) }
		const warn = vi.fn()
		const executor = createSqlExecutor(fakePayload({ name: 'sqlite', client }), {
			thread: 'main',
			warn,
		})
		await expect(executor.execute(sql`DELETE FROM t`)).rejects.toThrow(
			/cannot open one: the database is in memory/
		)
		await expect(executor.select(sql`SELECT 1`)).rejects.toThrow(/could lose the app's writes/)
		expect(warn).toHaveBeenCalledTimes(1)
	})

	it('takes the mode from ANALYTICS_SQLITE_THREAD when none is passed, refusing an unknown one', async () => {
		vi.stubEnv('ANALYTICS_SQLITE_THREAD', 'main')
		try {
			const executor = createSqlExecutor(
				fakePayload({ name: 'sqlite', client: libsql(), clientConfig: { url: 'file:/x.db' } })
			)
			expect(await executor.blocking()).toBe(true)
			vi.stubEnv('ANALYTICS_SQLITE_THREAD', 'sideways')
			expect(() => createSqlExecutor(fakePayload({ name: 'sqlite', client: libsql() }))).toThrow(
				/ANALYTICS_SQLITE_THREAD must be one of auto, worker, main, got "sideways"/
			)
		} finally {
			vi.unstubAllEnvs()
		}
	})

	it('never blocks on a remote database, which answers over the network', async () => {
		const client = { ...libsql(), protocol: 'https' }
		expect(await createSqlExecutor(fakePayload({ name: 'sqlite', client })).blocking()).toBe(false)
	})

	it('qualifies no table, SQLite having no schemas', () => {
		const executor = createSqlExecutor(
			fakePayload({ name: 'sqlite', client: libsql(), tableNameMap: tables, schemaName: 'stats' })
		)
		expect(compile(executor.table('analytics-state'), executor.dialect).text).toBe('"a_state"')
	})
})

describe('createSqlExecutor elsewhere', () => {
	it('refuses MongoDB and D1, which run no SQL here', () => {
		expect(() => createSqlExecutor(fakePayload({ name: 'mongoose' }))).toThrow(/MongoDB has no SQL/)
		expect(() =>
			createSqlExecutor(fakePayload({ name: 'sqlite', packageName: '@payloadcms/db-d1-sqlite' }))
		).toThrow(/D1/)
	})
})

describe('transactionSettings', () => {
	it('bounds a Postgres transaction’s statements, lock waits and idle time, in that order', () => {
		expect(
			transactionSettings(postgresDialect, {
				timeoutMs: 8000,
				lockTimeoutMs: 10_000,
				idleTimeoutMs: 60_000,
			})
		).toEqual([
			'SET LOCAL statement_timeout = 8000',
			'SET LOCAL lock_timeout = 10000',
			'SET LOCAL idle_in_transaction_session_timeout = 60000',
		])
		expect(transactionSettings(postgresDialect, {})).toEqual([])
	})

	it('plans a long read without JIT and sorts it in more memory on Postgres, nothing on SQLite', () => {
		expect(transactionSettings(postgresDialect, { timeoutMs: 3000, analytical: true })).toEqual([
			'SET LOCAL statement_timeout = 3000',
			'SET LOCAL jit = off',
			"SET LOCAL work_mem = '64MB'",
		])
		expect(transactionSettings(sqliteDialect, { analytical: true })).toEqual([])
	})

	it('runs a transaction’s lock and idle bounds on Postgres, after BEGIN', async () => {
		const ran: string[] = []
		const own = {
			query: async () => ({ rows: [], rowCount: 0 }),
			connect: async () => ({
				query: async (text: string) => {
					ran.push(text)
					return { rows: [], rowCount: 1 }
				},
				release: () => undefined,
			}),
		}
		const executor = createSqlExecutor(
			fakePayload({ name: 'postgres', pool: own, tableNameMap: tables })
		)
		await executor.transaction(async (tx) => tx.execute(sql`UPDATE t SET a = ${1}`), {
			lockTimeoutMs: 10_000,
			idleTimeoutMs: 60_000,
		})
		expect(ran).toEqual([
			'BEGIN; SET LOCAL lock_timeout = 10000; SET LOCAL idle_in_transaction_session_timeout = 60000',
			'UPDATE t SET a = $1',
			'COMMIT',
		])
	})
})

describe('helpers', () => {
	it('keys a collection the way the drizzle adapters key its table', () => {
		expect(tableKeyOf('analytics-hits')).toBe('analytics_hits')
		expect(tableKeyOf('analyticsHits')).toBe('analytics_hits')
		expect(tableKeyOf('payload-kv')).toBe('payload_kv')
	})
})
