import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hasMethods, isRecord } from '../../../core/values'
import { isUniqueViolation } from '../../../db/errors'
import { LONG_COUNT_SQL, stallBound, ticking } from '../../../testing/timerTicks'
import { isLibsqlClient, type LibsqlClient, rowsOf } from './drivers'
import { resolveLibsqlClient } from './sqliteThread'
import {
	createSqliteWorkers,
	type SpawnSqliteWorker,
	type SqliteLaneCount,
	SqliteRequestTimeout,
	type SqliteWorkers,
	SqliteWorkersClosed,
	spawnSqliteWorker,
	threadErrorOf,
} from './sqliteWorker'

type HostClient = LibsqlClient & { close(): void }

const resolved = resolveLibsqlClient(process.cwd())
if ('failure' in resolved) {
	throw new Error(resolved.failure)
}
const CLIENT_PATH = resolved.path

const isHostClient = (value: unknown): value is HostClient =>
	isLibsqlClient(value) && hasMethods(value, ['close'])

/** The host's own client, on the main thread, loaded from the copy the workers load. */
const hostClient = (url: string): HostClient => {
	const libsql: unknown = createRequire(import.meta.url)(CLIENT_PATH)
	const create = isRecord(libsql) ? libsql.createClient : undefined
	const client: unknown = typeof create === 'function' ? create({ url }) : undefined
	if (!isHostClient(client)) {
		throw new Error('analytics test: @libsql/client did not load')
	}
	return client
}

/**
 * A thread that dies on its first message. A real one is never stopped mid-statement here:
 * libsql's native code aborts the whole process when its thread is stopped under it.
 */
const DIES_ON_ITS_FIRST_MESSAGE = `
const { parentPort } = require('node:worker_threads')
parentPort.postMessage({ ready: { journalMode: 'wal', natives: [] } })
parentPort.on('message', () => process.exit(3))
`

/** A thread that starts and then answers nothing, as one stuck inside a statement would. */
const NEVER_ANSWERS = `
const { parentPort } = require('node:worker_threads')
parentPort.postMessage({ ready: { journalMode: 'wal', natives: [] } })
parentPort.on('message', () => undefined)
`

describe('SQLite worker threads', () => {
	let dir: string
	let url: string
	let host: HostClient
	const opened: SqliteWorkers[] = []

	const workers = (
		options: {
			busyTimeoutMs?: number
			lanes?: SqliteLaneCount
			spawn?: SpawnSqliteWorker
			requestTimeoutMs?: number
		} = {}
	): SqliteWorkers => {
		const made = createSqliteWorkers({
			data: {
				clientPath: CLIENT_PATH,
				config: { url },
				busyTimeoutMs: options.busyTimeoutMs ?? 2_000,
			},
			...(options.lanes === undefined ? {} : { lanes: options.lanes }),
			...(options.spawn === undefined ? {} : { spawn: options.spawn }),
			...(options.requestTimeoutMs === undefined
				? {}
				: { requestTimeoutMs: options.requestTimeoutMs }),
		})
		opened.push(made)
		return made
	}

	const ids = async (): Promise<string[]> =>
		rowsOf((await host.execute('SELECT id FROM t ORDER BY id')).rows).map((row) => String(row.id))

	beforeEach(async () => {
		dir = mkdtempSync(join(tmpdir(), 'analytics-sqlite-worker-'))
		url = `file:${join(dir, 'w.db')}`
		host = hostClient(url)
		await host.execute('PRAGMA journal_mode = WAL')
		await host.execute('PRAGMA busy_timeout = 5000')
		await host.execute('CREATE TABLE t (id TEXT PRIMARY KEY, v INTEGER)')
	})

	afterEach(async () => {
		await Promise.all(opened.splice(0).map((each) => each.close()))
		host.close()
		rmSync(dir, { recursive: true, force: true })
	})

	it('reports its journal mode and the libsql library it loaded once its connection is open', async () => {
		const ready = await workers({ lanes: 1 }).ready()
		expect(ready?.journalMode).toBe('wal')
		expect(ready?.natives.some((path) => path.endsWith('.node'))).toBe(true)
	})

	it('answers rows as plain objects of their columns, and writes with their row counts', async () => {
		const { driver } = workers()
		expect(await driver.write("INSERT INTO t (id, v) VALUES ('a', 1), ('b', 2)", [])).toEqual({
			rows: [],
			rowCount: 2,
		})
		const read = await driver.run('SELECT id, v, ? AS tag FROM t ORDER BY id', ['x'], {
			kind: 'long',
		})
		expect(read.rows).toEqual([
			{ id: 'a', v: 1, tag: 'x' },
			{ id: 'b', v: 2, tag: 'x' },
		])
		expect(read.rows.every((row) => Object.getPrototypeOf(row) === Object.prototype)).toBe(true)
	})

	it('answers a big read in parts, whole and in order', async () => {
		const { driver } = workers()
		const { rows } = await driver.run(
			'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 12345) SELECT x FROM c',
			[],
			{ kind: 'long' }
		)
		expect(rows).toHaveLength(12_345)
		expect(rows.every((row, index) => row.x === index + 1)).toBe(true)
	})

	it('runs a batch in one transaction: every result in order, or nothing at all', async () => {
		const { driver } = workers()
		const { results } = await driver.batch([
			{ text: 'INSERT INTO t (id, v) VALUES (?, 1)', values: ['a'] },
			{ text: 'INSERT INTO t (id, v) VALUES (?, 2), (?, 3)', values: ['b', 'c'] },
		])
		expect(results.map((result) => result.rowCount)).toEqual([1, 2])
		await expect(
			driver.batch([
				{ text: 'INSERT INTO t (id, v) VALUES (?, 4)', values: ['d'] },
				{ text: 'INSERT INTO t (id, v) VALUES (?, 5)', values: ['a'] },
			])
		).rejects.toThrow(/UNIQUE/)
		expect(await ids()).toEqual(['a', 'b', 'c'])
	})

	it('rolls a batch back at the first statement that changes other rows than it expects', async () => {
		const { driver } = workers()
		const outcome = await driver.batch([
			{ text: "INSERT INTO t (id, v) VALUES ('a', 1)", values: [] },
			{ text: "UPDATE t SET v = 2 WHERE id = 'nobody'", values: [], expect: 1 },
			{ text: "INSERT INTO t (id, v) VALUES ('b', 3)", values: [] },
		])
		expect(outcome).toEqual({
			committed: false,
			failedAt: 1,
			results: [
				{ rows: [], rowCount: 1 },
				{ rows: [], rowCount: 0 },
			],
		})
		expect(await ids()).toEqual([])
		expect(
			await driver.batch([
				{ text: "INSERT INTO t (id, v) VALUES ('a', 1)", values: [] },
				{ text: "UPDATE t SET v = 2 WHERE id = 'a'", values: [], expect: 1 },
			])
		).toMatchObject({ committed: true })
		expect(await ids()).toEqual(['a'])
	})

	it('hands a batch too big for one message over in parts, and writes it whole', async () => {
		const { driver } = workers()
		const rowsEach = 10_000
		const statements = Array.from({ length: 6 }, (_, part) => ({
			text: `INSERT INTO t (id, v) VALUES ${Array.from({ length: rowsEach }, () => '(?, 0)').join(', ')}`,
			values: Array.from({ length: rowsEach }, (_, i) => `p${part}-${String(i).padStart(5, '0')}`),
		}))
		const outcome = await driver.batch([
			...statements,
			{ text: "UPDATE t SET v = 1 WHERE id = 'p5-09999'", values: [], expect: 1 },
		])
		expect(outcome).toMatchObject({ committed: true })
		expect(outcome.results.map((result) => result.rowCount)).toEqual([
			...statements.map(() => rowsEach),
			1,
		])
		expect((await ids()).length).toBe(6 * rowsEach)
	})

	it('writes a batch whole while the host blocks this thread on the same lock', async () => {
		const { driver } = workers()
		await driver.write("INSERT INTO t (id, v) VALUES ('seed', 0)", [])
		const statements = Array.from({ length: 200 }, (_, i) => ({
			text: 'INSERT INTO t (id, v) VALUES (?, ?)',
			values: [`b${String(i).padStart(3, '0')}`, i],
		}))
		const batch = driver.batch([
			...statements,
			{ text: "UPDATE t SET v = 1 WHERE id = 'seed'", values: [], expect: 1 },
		])
		await new Promise((resolve) => setImmediate(resolve))
		// A synchronous host write on this thread, waiting in SQLite's busy handler for the batch.
		await host.execute("INSERT INTO t (id, v) VALUES ('host', 9)")
		expect(await batch).toMatchObject({ committed: true })
		expect((await ids()).length).toBe(202)
	})

	it('commits a transaction that resolves, and rolls back one whose work throws', async () => {
		const { driver } = workers()
		const answer = await driver.transaction(async (tx) => {
			await tx.run("INSERT INTO t (id, v) VALUES ('a', 1)", [])
			return (await tx.run('SELECT count(*) AS n FROM t', [])).rows[0]?.n
		}, {})
		expect(answer).toBe(1)
		await expect(
			driver.transaction(async (tx) => {
				await tx.run("INSERT INTO t (id, v) VALUES ('b', 2)", [])
				throw new Error('work failed')
			}, {})
		).rejects.toThrow('work failed')
		expect(await ids()).toEqual(['a'])
	})

	it('carries a driver error across with its codes, so the error checks still read it', async () => {
		const { driver } = workers()
		await driver.write("INSERT INTO t (id, v) VALUES ('a', 1)", [])
		const failure = await driver
			.write("INSERT INTO t (id, v) VALUES ('a', 2)", [])
			.catch((err: unknown) => err)
		expect(failure).toBeInstanceOf(Error)
		expect(failure).toMatchObject({ name: 'LibsqlError', code: 'SQLITE_CONSTRAINT_PRIMARYKEY' })
		expect(isUniqueViolation(failure)).toBe(true)
		expect(
			threadErrorOf({ message: 'x', code: 'SQLITE_BUSY', rawCode: 5, cause: { message: 'y' } })
		).toMatchObject({
			message: 'x',
			code: 'SQLITE_BUSY',
			rawCode: 5,
			cause: { message: 'y' },
		})
	})

	it('keeps this thread’s timers running through a long statement', async () => {
		const { driver } = workers()
		const run = await ticking(() => driver.run(LONG_COUNT_SQL, [], { kind: 'count' }))
		expect(run).toMatchObject({ value: { rows: [{ n: 4_000_000 }] } })
		expect(run.ms).toBeGreaterThan(150)
		expect(run.ticks).toBeGreaterThan(run.ms / 40)
		expect(run.worstGapMs).toBeLessThan(stallBound(run.ms))
	})

	it('waits on its own thread for a lock the host holds across awaits, and the write lands', async () => {
		const made = workers({ busyTimeoutMs: 3_000 })
		const { driver } = made
		await made.ready()
		const tx = await host.transaction('write')
		await tx.execute({ sql: "INSERT INTO t (id, v) VALUES ('host', 1)", args: [] })
		const commit = new Promise<void>((resolve) => {
			setTimeout(() => {
				void tx.commit().then(() => {
					tx.close()
					resolve()
				})
			}, 300)
		})
		const run = await ticking(() => driver.write("INSERT INTO t (id, v) VALUES ('engine', 2)", []))
		await commit
		expect(run).toMatchObject({ value: { rowCount: 1 } })
		expect(run.ms).toBeGreaterThan(250)
		expect(run.ticks).toBeGreaterThan(10)
		expect(run.worstGapMs).toBeLessThan(stallBound(run.ms))
		expect(await ids()).toEqual(['engine', 'host'])
	})

	it('fails with SQLITE_BUSY once its wait runs out, and loses nothing written after', async () => {
		const { driver } = workers({ busyTimeoutMs: 200 })
		const tx = await host.transaction('write')
		await tx.execute({ sql: "INSERT INTO t (id, v) VALUES ('host', 1)", args: [] })
		const run = await ticking(() => driver.write("INSERT INTO t (id, v) VALUES ('lost', 2)", []))
		expect(run).toMatchObject({ error: { code: 'SQLITE_BUSY' } })
		expect(run.ticks).toBeGreaterThan(5)
		await tx.commit()
		tx.close()
		await driver.write("INSERT INTO t (id, v) VALUES ('after', 3)", [])
		await driver.transaction(async (session) => {
			await session.run("INSERT INTO t (id, v) VALUES ('after-tx', 4)", [])
		}, {})
		expect(await ids()).toEqual(['after', 'after-tx', 'host'])
	})

	it('runs a write beside a long count on separate threads, and after it on a single one', async () => {
		// Which settles first, rather than how long each took: a loaded machine slows every thread.
		const settled = async (lanes: SqliteLaneCount) => {
			const { driver } = workers({ lanes })
			await driver.run('SELECT 1', [], { kind: 'count' })
			await driver.run('SELECT 1', [], { kind: 'long' })
			let countedAt = Number.POSITIVE_INFINITY
			const counting = driver.run(LONG_COUNT_SQL, [], { kind: 'count' }).then(() => {
				countedAt = performance.now()
			})
			await new Promise((resolve) => setTimeout(resolve, 20))
			await driver.write(`INSERT INTO t (id, v) VALUES ('w${lanes}', 1)`, [])
			const wroteAt = performance.now()
			await counting
			return { wroteAt, countedAt }
		}
		const split = await settled(3)
		const single = await settled(1)
		expect(split.wroteAt).toBeLessThan(split.countedAt)
		expect(single.wroteAt).toBeGreaterThanOrEqual(single.countedAt)
	})

	it('starts a thread again after it died, failing only what it was running', async () => {
		const spawned: Worker[] = []
		const spawn: SpawnSqliteWorker = (data) => {
			const worker =
				spawned.length === 0
					? new Worker(DIES_ON_ITS_FIRST_MESSAGE, { eval: true })
					: spawnSqliteWorker(data)
			spawned.push(worker)
			return worker
		}
		const { driver } = workers({ lanes: 1, spawn })
		await expect(driver.write("INSERT INTO t (id, v) VALUES ('a', 1)", [])).rejects.toThrow(
			/stopped \(exit code 3\)/
		)
		await driver.write("INSERT INTO t (id, v) VALUES ('b', 2)", [])
		expect(spawned).toHaveLength(2)
		expect(await ids()).toEqual(['b'])
	})

	it('fails a request its thread never answers, and runs the next on a new thread', async () => {
		const spawned: Worker[] = []
		const spawn: SpawnSqliteWorker = (data) => {
			const worker =
				spawned.length === 0 ? new Worker(NEVER_ANSWERS, { eval: true }) : spawnSqliteWorker(data)
			spawned.push(worker)
			return worker
		}
		const { driver } = workers({ lanes: 1, spawn, requestTimeoutMs: 200 })
		try {
			await expect(
				driver.write("INSERT INTO t (id, v) VALUES ('a', 1)", [])
			).rejects.toBeInstanceOf(SqliteRequestTimeout)
			await driver.write("INSERT INTO t (id, v) VALUES ('b', 2)", [])
			expect(spawned).toHaveLength(2)
			expect(await ids()).toEqual(['b'])
		} finally {
			await spawned[0]?.terminate()
		}
	})

	it('rolls back a transaction left idle past its limit, freeing the lock', async () => {
		const { driver } = workers()
		const idle = driver.transaction(
			async (tx) => {
				await tx.run("INSERT INTO t (id, v) VALUES ('idle', 1)", [])
				await new Promise((resolve) => setTimeout(resolve, 300))
				await tx.run("INSERT INTO t (id, v) VALUES ('late', 2)", [])
			},
			{ idleTimeoutMs: 100 }
		)
		await expect(idle).rejects.toThrow(/transaction is gone/)
		await host.execute("INSERT INTO t (id, v) VALUES ('host', 3)")
		expect(await ids()).toEqual(['host'])
	})

	it('keeps no process alive while idle, and stops every thread for good on close', async () => {
		const refs: string[] = []
		const spawned: Worker[] = []
		const spawn: SpawnSqliteWorker = (data) => {
			const worker = spawnSqliteWorker(data)
			spawned.push(worker)
			const ref = worker.ref.bind(worker)
			const unref = worker.unref.bind(worker)
			worker.ref = () => {
				refs.push('ref')
				ref()
			}
			worker.unref = () => {
				refs.push('unref')
				unref()
			}
			return worker
		}
		const made = workers({ spawn })
		await made.driver.write("INSERT INTO t (id, v) VALUES ('a', 1)", [])
		expect(refs.at(-1)).toBe('unref')
		const exits = spawned.map(
			(worker) => new Promise<number>((resolve) => worker.once('exit', resolve))
		)
		await made.close()
		expect(await Promise.all(exits)).toHaveLength(1)
		await expect(made.driver.run('SELECT 1', [])).rejects.toBeInstanceOf(SqliteWorkersClosed)
		expect(spawned).toHaveLength(1)
	})
})
