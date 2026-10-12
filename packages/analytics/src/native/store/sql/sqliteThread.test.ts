import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Worker } from 'node:worker_threads'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DriverResult, LibsqlClient, SqlDriver } from './drivers'
import {
	closeSqliteWorkers,
	type DecideDeps,
	type DecideInput,
	decideThread,
	hostLibsqlNatives,
	isMemoryUrl,
	MAIN_THREAD_STALL_MS,
	resolveLibsqlClient,
	SqliteThreadUnavailable,
	sameLibrary,
	sqliteThreadDriver,
} from './sqliteThread'
import { type SpawnSqliteWorker, type SqliteWorkers, spawnSqliteWorker } from './sqliteWorker'

const NATIVE = '/lib/libsql/darwin-arm64/index.node'

/** Threads that start, or fail to, without starting any. */
const fakeWorkers = (ready: () => Promise<{ journalMode: string; natives: string[] }>) => {
	const driver: SqlDriver = {
		run: async () => ({ rows: [], rowCount: 0 }),
		write: async () => ({ rows: [], rowCount: 0 }),
		batch: async () => ({ committed: true, results: [] }),
		transaction: (work) => work({ run: async () => ({ rows: [], rowCount: 0 }) }),
	}
	const workers: SqliteWorkers = { driver, ready, close: async () => undefined }
	return workers
}

const deps = (overrides: Partial<DecideDeps> = {}) => {
	const workers = fakeWorkers(async () => ({ journalMode: 'wal', natives: [NATIVE] }))
	const acquire = vi.fn(() => workers)
	const release = vi.fn(async () => undefined)
	const all: DecideDeps = {
		journalMode: async () => 'wal',
		resolveClient: () => ({ path: '/node_modules/@libsql/client/lib-cjs/node.js' }),
		acquire,
		release,
		hostNatives: () => [NATIVE],
		...overrides,
	}
	return { deps: all, acquire, release, workers }
}

const input = (overrides: Partial<DecideInput> = {}): DecideInput => ({
	requested: 'auto',
	url: 'file:/data/payload.db',
	adapterBusyTimeoutMs: 5_000,
	...overrides,
})

describe('decideThread', () => {
	it('takes worker threads on a WAL file whose adapter waits 5 seconds, on the host’s own libsql', async () => {
		const { deps: all, workers } = deps()
		expect(await decideThread(input(), all)).toEqual({ thread: 'worker', workers, reasons: [] })
	})

	it('stays on the main thread when asked to, without asking the database anything', async () => {
		const journalMode = vi.fn(async () => 'wal')
		const { deps: all, acquire } = deps({ journalMode })
		expect(await decideThread(input({ requested: 'main' }), all)).toEqual({
			thread: 'main',
			reasons: [],
		})
		expect(journalMode).not.toHaveBeenCalled()
		expect(acquire).not.toHaveBeenCalled()
	})

	it('stays on the main thread, saying why, when the database or the adapter does not suit', async () => {
		const { deps: all, acquire } = deps({ journalMode: async () => 'delete' })
		expect(await decideThread(input({ adapterBusyTimeoutMs: 0 }), all)).toEqual({
			thread: 'main',
			reasons: [
				"the database's journal mode is delete, not WAL",
				"the adapter's busyTimeout is 0 ms, below 5000",
			],
		})
		expect(acquire).not.toHaveBeenCalled()
	})

	it('stays on the main thread for a database a second connection cannot open', async () => {
		for (const url of [
			undefined,
			':memory:',
			'file::memory:?cache=shared',
			'file:x.db?mode=memory',
		]) {
			const decided = await decideThread(input({ url }), deps().deps)
			expect(decided.thread).toBe('main')
		}
		expect(await decideThread(input({ replica: true }), deps().deps)).toEqual({
			thread: 'main',
			reasons: ['an embedded replica (syncUrl) syncs through the adapter’s own client alone'],
		})
	})

	it('stays on the main thread when the client, the thread or the library check fails, letting go of the threads', async () => {
		const unresolved = deps({
			resolveClient: () => ({ failure: '@libsql/client could not be resolved' }),
		})
		expect(await decideThread(input(), unresolved.deps)).toEqual({
			thread: 'main',
			reasons: ['@libsql/client could not be resolved'],
		})
		const broken = fakeWorkers(async () => {
			throw new Error('no binary')
		})
		const failing = deps({ acquire: vi.fn(() => broken) })
		expect(await decideThread(input(), failing.deps)).toMatchObject({
			thread: 'main',
			reasons: ['its worker thread did not start: no binary'],
		})
		expect(failing.release).toHaveBeenCalledWith(broken)
		const other = deps({ hostNatives: () => ['/elsewhere/libsql/index.node'] })
		const decided = await decideThread(input(), other.deps)
		expect(decided.thread).toBe('main')
		expect(decided.reasons[0]).toMatch(/another copy of libsql/)
		expect(other.release).toHaveBeenCalled()
		const unknown = deps({ hostNatives: () => [] })
		expect((await decideThread(input(), unknown.deps)).thread).toBe('main')
		expect(unknown.release).toHaveBeenCalled()
	})

	it('takes worker threads when forced, saying what makes them unwise', async () => {
		const { deps: all, workers } = deps({
			journalMode: async () => 'delete',
			hostNatives: () => [],
		})
		const decided = await decideThread(input({ requested: 'worker', adapterBusyTimeoutMs: 0 }), all)
		expect(decided).toMatchObject({ thread: 'worker', workers })
		expect(decided.reasons).toHaveLength(3)
	})

	it('refuses to force them where they cannot work', async () => {
		const forced = input({ requested: 'worker' })
		await expect(decideThread({ ...forced, url: ':memory:' }, deps().deps)).rejects.toBeInstanceOf(
			SqliteThreadUnavailable
		)
		await expect(
			decideThread(forced, deps({ resolveClient: () => ({ failure: 'nothing there' }) }).deps)
		).rejects.toThrow(/thread: 'worker'.*nothing there/)
		await expect(
			decideThread(forced, deps({ hostNatives: () => ['/elsewhere/libsql/index.node'] }).deps)
		).rejects.toThrow(/another copy of libsql/)
	})
})

describe('the helpers', () => {
	it('resolves @libsql/client through the adapter installed under the working directory', () => {
		const found = resolveLibsqlClient(process.cwd())
		expect(found).toMatchObject({
			path: expect.stringMatching(/@libsql\/client\/lib-cjs\/node\.js$/),
		})
	})

	it('says where it looked when neither way finds it', () => {
		const found = resolveLibsqlClient(process.cwd(), {
			adapter: '@payloadcms/db-nothing',
			client: '@libsql/nothing',
		})
		expect(found).toMatchObject({
			failure: expect.stringMatching(
				/^@libsql\/nothing could not be resolved from .+ \(through @payloadcms\/db-nothing: .+; directly: .+\)$/
			),
		})
	})

	it('compares the native libraries each thread loaded', () => {
		expect(sameLibrary(['/a.node', '/b.node'], ['/a.node'])).toBe('same')
		expect(sameLibrary(['/a.node'], ['/c.node'])).toBe('different')
		expect(sameLibrary([], ['/a.node'])).toBe('unknown')
		expect(sameLibrary(['/a.node'], [])).toBe('unknown')
	})

	it('tells an in-memory database from a file', () => {
		expect(isMemoryUrl(':memory:')).toBe(true)
		expect(isMemoryUrl('file::memory:')).toBe(true)
		expect(isMemoryUrl('file:db?mode=memory&cache=shared')).toBe(true)
		expect(isMemoryUrl('file:./payload.db')).toBe(false)
		expect(isMemoryUrl('file:memory.db')).toBe(false)
	})

	it('reads the libsql native libraries this thread loaded', () => {
		expect(Array.isArray(hostLibsqlNatives(process.cwd()))).toBe(true)
	})
})

describe('sqliteThreadDriver', () => {
	const dirs: string[] = []
	const clients: object[] = []

	afterEach(async () => {
		await Promise.all(clients.splice(0).map((client) => closeSqliteWorkers(client)))
		for (const dir of dirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true })
		}
	})

	/** A host client that answers the journal mode, standing in for the adapter's. */
	const hostOf = (journal: string): LibsqlClient => {
		const client: LibsqlClient = {
			protocol: 'file',
			execute: async () => ({ rows: [{ journal_mode: journal }], rowsAffected: 0 }),
			batch: async () => [],
			transaction: async () => {
				throw new Error('not used')
			},
		}
		clients.push(client)
		return client
	}

	const mainDriver = (): SqlDriver & { ran: string[] } => {
		const ran: string[] = []
		const result: DriverResult = { rows: [], rowCount: 0 }
		return {
			ran,
			run: async (text) => {
				ran.push(text)
				return result
			},
			write: async (text) => {
				ran.push(text)
				return result
			},
			batch: async () => ({ committed: true, results: [] }),
			transaction: (work) => work({ run: async () => result }),
		}
	}

	const file = (): string => {
		const dir = mkdtempSync(join(tmpdir(), 'analytics-thread-driver-'))
		dirs.push(dir)
		return `file:${join(dir, 'd.db')}`
	}

	it('runs on the main thread and warns once per client when the database does not suit', async () => {
		const client = hostOf('delete')
		const warn = vi.fn()
		const make = () => {
			const main = mainDriver()
			const driver = sqliteThreadDriver({
				client,
				main,
				clientConfig: { url: file() },
				busyTimeoutMs: 5_000,
				adapterBusyTimeoutMs: 5_000,
				requested: 'auto',
				warn,
			})
			return { driver, main }
		}
		const first = make()
		const second = make()
		await first.driver.run('SELECT 1', [], { kind: 'count' })
		await second.driver.write('INSERT 1', [])
		expect(first.main.ran).toEqual(['SELECT 1'])
		expect(second.main.ran).toEqual(['INSERT 1'])
		expect(await first.driver.blocking()).toBe(true)
		expect(warn).toHaveBeenCalledTimes(1)
		expect(warn.mock.calls[0]?.[0]).toContain('sqliteAdapter({ wal: true, busyTimeout: 5000 })')
		expect(warn.mock.calls[0]?.[0]).toContain(`${MAIN_THREAD_STALL_MS} ms`)
		expect(warn.mock.calls[0]?.[0]).toContain(
			'second process only once the adapter has wal: true and a busyTimeout of at least 5000'
		)
		expect(warn.mock.calls[0]?.[0]).not.toContain('outside the web process')
	})

	it('lets the event loop turn after each statement on the main thread, never inside a transaction', async () => {
		const order: string[] = []
		const driver = sqliteThreadDriver({
			client: hostOf('wal'),
			main: mainDriver(),
			clientConfig: { url: file() },
			busyTimeoutMs: 5_000,
			adapterBusyTimeoutMs: 5_000,
			requested: 'main',
			warn: () => undefined,
		})
		setImmediate(() => order.push('a request'))
		await driver.run('SELECT 1', [])
		order.push('the next statement')
		await driver.transaction(async (session) => {
			setImmediate(() => order.push('a request inside'))
			await session.run('UPDATE 1', [])
			order.push('the transaction goes on')
		}, {})
		expect(order).toEqual([
			'a request',
			'the next statement',
			'the transaction goes on',
			'a request inside',
		])
	})

	it('runs statements of chains resumed together one per turn of the event loop', async () => {
		const main = mainDriver()
		const driver = sqliteThreadDriver({
			client: hostOf('wal'),
			main,
			clientConfig: { url: file() },
			busyTimeoutMs: 5_000,
			adapterBusyTimeoutMs: 5_000,
			requested: 'main',
			warn: () => undefined,
		})
		let turns = 0
		let counting = true
		const count = (): void => {
			turns += 1
			if (counting) {
				setImmediate(count)
			}
		}
		setImmediate(count)
		const seen: number[] = []
		await Promise.all(
			['A', 'B', 'C', 'D'].map(async (chain) => {
				await driver.run(`${chain}1`, [])
				seen.push(turns)
				await driver.run(`${chain}2`, [])
				seen.push(turns)
			})
		)
		counting = false
		expect(main.ran).toHaveLength(8)
		expect(new Set(seen).size).toBe(seen.length)
	})

	it('shares one set of threads among the drivers on a client, stopping them when the last lets go', async () => {
		const client = hostOf('wal')
		const url = file()
		const spawned: Worker[] = []
		const spawn: SpawnSqliteWorker = (data) => {
			const worker = spawnSqliteWorker(data)
			spawned.push(worker)
			return worker
		}
		const make = () =>
			sqliteThreadDriver({
				client,
				main: mainDriver(),
				clientConfig: { url, intMode: 'number', fetch: () => undefined },
				busyTimeoutMs: 5_000,
				adapterBusyTimeoutMs: 5_000,
				requested: 'worker',
				warn: () => undefined,
				spawn,
			})
		const first = make()
		const second = make()
		await first.write('CREATE TABLE t (id TEXT PRIMARY KEY)', [])
		await second.write("INSERT INTO t (id) VALUES ('a')", [])
		expect((await first.run('SELECT id FROM t', [], { kind: 'long' })).rows).toEqual([{ id: 'a' }])
		expect(await second.blocking()).toBe(false)
		expect(spawned).toHaveLength(2)
		const exits = spawned.map((worker) => new Promise((resolve) => worker.once('exit', resolve)))
		await first.close()
		expect(spawned.every((worker) => worker.threadId > 0)).toBe(true)
		await second.close()
		await Promise.all(exits)
	})

	it('fails every statement when worker threads are forced where they cannot run', async () => {
		const driver = sqliteThreadDriver({
			client: hostOf('wal'),
			main: mainDriver(),
			clientConfig: { url: ':memory:' },
			busyTimeoutMs: 5_000,
			adapterBusyTimeoutMs: 5_000,
			requested: 'worker',
			warn: () => undefined,
		})
		await expect(driver.run('SELECT 1', [])).rejects.toBeInstanceOf(SqliteThreadUnavailable)
		await expect(driver.blocking()).rejects.toBeInstanceOf(SqliteThreadUnavailable)
	})
})
