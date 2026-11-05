import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { isOneOf, isRecord } from '../../../core/values'
import { yieldToLoop } from '../chunks'
import { exclusive, type LibsqlClient, type SqlDriver } from './drivers'
import {
	type ClientConfig,
	createSqliteWorkers,
	type SpawnSqliteWorker,
	type SqliteLaneCount,
	type SqliteWorkerData,
	type SqliteWorkerReady,
	type SqliteWorkers,
	SqliteWorkersClosed,
} from './sqliteWorker'

/**
 * Where engine statements on a local SQLite file run: `worker` on threads of their own, `main` on
 * the request thread, `auto` on workers when the database can take them (see {@link decideThread}).
 */
export type SqliteThread = 'auto' | 'worker' | 'main'

export const SQLITE_THREADS: readonly SqliteThread[] = ['auto', 'worker', 'main']

export const isSqliteThread = (value: unknown): value is SqliteThread =>
	isOneOf(SQLITE_THREADS, value)

/** The environment variable that picks the mode where `native({ sqlite: { thread } })` does not. */
export const SQLITE_THREAD_ENV = 'ANALYTICS_SQLITE_THREAD'

/**
 * The busy timeout the host's adapter needs before the engine writes from another connection: its
 * own writes then wait out the engine's short write transactions instead of failing at once.
 */
const OFF_THREAD_BUSY_TIMEOUT_MS = 5_000

/** How long one engine statement may hold the main thread, where it holds up every request. */
export const MAIN_THREAD_STALL_MS = 150

const ADAPTER_ADVICE = `sqliteAdapter({ wal: true, busyTimeout: ${OFF_THREAD_BUSY_TIMEOUT_MS} })`

/** Joined at runtime, so that no bundler takes them for imports to resolve at build time. */
const DB_SQLITE = ['@payloadcms', 'db-sqlite'].join('/')
const LIBSQL_CLIENT = ['@libsql', 'client'].join('/')

/** An error's message, or anything else thrown as its text. */
export const messageOf = (err: unknown): string =>
	err instanceof Error ? err.message : String(err)

/** A resolution error's first line, without the require stack Node appends. */
const firstLine = (err: unknown): string => messageOf(err).split('\n')[0] ?? ''

export type ClientResolution = { path: string } | { failure: string }

/**
 * `@libsql/client` as the host loads it: through `@payloadcms/db-sqlite` under `cwd` first, then
 * from `cwd` itself, where Next's standalone output keeps the client it traced.
 */
export const resolveLibsqlClient = (
	cwd: string,
	packages: { adapter: string; client: string } = { adapter: DB_SQLITE, client: LIBSQL_CLIENT }
): ClientResolution => {
	const fromCwd = createRequire(join(cwd, 'package.json'))
	const tried: string[] = []
	try {
		const adapter = fromCwd.resolve(packages.adapter)
		return { path: createRequire(adapter).resolve(packages.client) }
	} catch (err) {
		tried.push(`through ${packages.adapter}: ${firstLine(err)}`)
	}
	try {
		return { path: fromCwd.resolve(packages.client) }
	} catch (err) {
		tried.push(`directly: ${firstLine(err)}`)
	}
	return {
		failure: `${packages.client} could not be resolved from ${cwd} (${tried.join('; ')})`,
	}
}

const realpath = (path: string): string => {
	try {
		return realpathSync(path)
	} catch {
		return path
	}
}

/** The libsql native libraries this thread loaded, by real path, from Node's module cache. */
export const hostLibsqlNatives = (cwd: string): string[] =>
	Object.keys(createRequire(join(cwd, 'package.json')).cache)
		.filter((key) => key.endsWith('.node') && key.includes('libsql'))
		.map(realpath)

/**
 * Whether a worker loaded the very libsql library the host did. Two copies of SQLite in one
 * process do not see each other's locks, and would both write at once.
 */
export const sameLibrary = (
	host: readonly string[],
	worker: readonly string[]
): 'same' | 'different' | 'unknown' => {
	if (host.length === 0 || worker.length === 0) {
		return 'unknown'
	}
	return worker.every((path) => host.includes(path)) ? 'same' : 'different'
}

/** An in-memory database, which a second connection would open empty. */
export const isMemoryUrl = (url: string): boolean =>
	url === ':memory:' || url.startsWith('file::memory:') || /[?&]mode=memory(&|$)/.test(url)

/** `worker` was asked for, and the database cannot take it: every statement fails with this. */
export class SqliteThreadUnavailable extends Error {}

export type ThreadDecision =
	| { thread: 'main'; reasons: string[] }
	| { thread: 'worker'; workers: SqliteWorkers; reasons: string[] }

export interface DecideInput {
	requested: SqliteThread
	/** The adapter's `client.url`; undefined when it keeps no client config. */
	url: string | undefined
	/** The adapter's `busyTimeout`, 0 when it set none. */
	adapterBusyTimeoutMs: number
	/** The client config names a `syncUrl`: an embedded replica of a remote database. */
	replica?: boolean
}

export interface DecideDeps {
	journalMode(): Promise<string | null>
	resolveClient(): ClientResolution
	/** The shared threads for that client entry, started and handed back. */
	acquire(clientPath: string): SqliteWorkers
	release(workers: SqliteWorkers): Promise<void>
	hostNatives(): string[]
}

/**
 * `auto` takes worker threads only with WAL, an adapter busy timeout of at least 5 s and the
 * host's libsql library, else stays on main and says why; `worker` throws only where impossible.
 */
export const decideThread = async (
	input: DecideInput,
	deps: DecideDeps
): Promise<ThreadDecision> => {
	const { requested } = input
	if (requested === 'main') {
		return { thread: 'main', reasons: [] }
	}
	const forced = requested === 'worker'
	const impossible = (reason: string): ThreadDecision => {
		if (forced) {
			throw new SqliteThreadUnavailable(
				`analytics: native({ sqlite: { thread: 'worker' } }) cannot run the engine on worker threads: ${reason}`
			)
		}
		return { thread: 'main', reasons: [reason] }
	}
	if (input.url === undefined) {
		return impossible('the adapter keeps no client url to open a second connection with')
	}
	if (isMemoryUrl(input.url)) {
		return impossible('an in-memory database cannot be opened by a second connection')
	}
	if (input.replica) {
		return impossible('an embedded replica (syncUrl) syncs through the adapter’s own client alone')
	}
	const unwise: string[] = []
	const journal = await deps.journalMode()
	if (journal !== 'wal') {
		unwise.push(`the database's journal mode is ${journal ?? 'unknown'}, not WAL`)
	}
	if (input.adapterBusyTimeoutMs < OFF_THREAD_BUSY_TIMEOUT_MS) {
		unwise.push(
			`the adapter's busyTimeout is ${input.adapterBusyTimeoutMs} ms, below ${OFF_THREAD_BUSY_TIMEOUT_MS}`
		)
	}
	if (!forced && unwise.length > 0) {
		return { thread: 'main', reasons: unwise }
	}
	const client = deps.resolveClient()
	if ('failure' in client) {
		return impossible(client.failure)
	}
	const workers = deps.acquire(client.path)
	let ready: SqliteWorkerReady
	try {
		ready = await workers.ready()
	} catch (err) {
		await deps.release(workers)
		return impossible(`its worker thread did not start: ${messageOf(err)}`)
	}
	const library = sameLibrary(deps.hostNatives(), ready.natives)
	if (library === 'different') {
		await deps.release(workers)
		return impossible(
			`${client.path} loads another copy of libsql than the host's, and two copies in one process do not see each other's locks`
		)
	}
	if (library === 'unknown') {
		const unknown = `the libsql library the host loaded could not be compared with the worker's (${client.path})`
		if (!forced) {
			await deps.release(workers)
			return { thread: 'main', reasons: [unknown] }
		}
		unwise.push(unknown)
	}
	return { thread: 'worker', workers, reasons: unwise }
}

/** The main-thread warning, said once per database client. */
const mainThreadWarning = (reasons: readonly string[]): string =>
	`analytics: the native engine runs its SQLite statements on the main thread, where each one holds up every request until it ends (${reasons.join('; ')}). Configure ${ADAPTER_ADVICE} to run them on worker threads. Until then a read that would hold the thread past about ${MAIN_THREAD_STALL_MS} ms is refused or split into days, today is served from snapshots, and a day too big to count that quickly waits for the analytics-maintain job. Run that job in a second process only once the adapter has wal: true and a busyTimeout of at least ${OFF_THREAD_BUSY_TIMEOUT_MS}: without them its locks make this process's own writes fail and can lose them.`

/** The warning when `worker` was forced on a database that does not suit it. */
const forcedWorkerWarning = (reasons: readonly string[]): string =>
	`analytics: native({ sqlite: { thread: 'worker' } }) runs the engine on worker threads although ${reasons.join('; ')}. A long read can then keep the host's writes waiting; ${ADAPTER_ADVICE} avoids that.`

interface SharedWorkers {
	workers: SqliteWorkers
	holders: number
}

/** Each host client's threads, by what they were started with: one set per database and timeout. */
const shared = new WeakMap<object, Map<string, SharedWorkers>>()

const sharedOf = (client: object): Map<string, SharedWorkers> => {
	const known = shared.get(client)
	if (known) {
		return known
	}
	const fresh = new Map<string, SharedWorkers>()
	shared.set(client, fresh)
	return fresh
}

/** Clients whose Payload instance was destroyed: no thread starts for them again. */
const destroyed = new WeakSet<object>()

/** Stops every thread started for `client`, as its Payload instance is destroyed, for good. */
export const closeSqliteWorkers = async (client: object): Promise<void> => {
	destroyed.add(client)
	const all = shared.get(client)
	if (!all) {
		return
	}
	const closing = [...all.values()].map((each) => each.workers.close())
	all.clear()
	await Promise.all(closing)
}

/** Each client's warnings said already. */
const warned = new WeakMap<object, Set<string>>()

const warnOnce = (client: object, warn: (message: string) => void, message: string): void => {
	const said = warned.get(client) ?? new Set<string>()
	warned.set(client, said)
	if (!said.has(message)) {
		said.add(message)
		warn(message)
	}
}

/** The plain values of the adapter's client config: what a worker thread can be handed. */
export const configOf = (value: unknown): ClientConfig => {
	const config: Record<string, string | number | boolean> = {}
	if (!isRecord(value)) {
		return config
	}
	for (const [key, each] of Object.entries(value)) {
		if (typeof each === 'string' || typeof each === 'number' || typeof each === 'boolean') {
			config[key] = each
		}
	}
	return config
}

const journalModeOf = async (client: LibsqlClient): Promise<string | null> => {
	const { rows } = await client.execute('PRAGMA journal_mode')
	const [first] = Array.isArray(rows) ? rows : []
	const mode = isRecord(first) ? first.journal_mode : undefined
	return typeof mode === 'string' ? mode.toLowerCase() : null
}

/** Each client's turn on the main thread: a key of its own, apart from the write queue's. */
const turns = new WeakMap<object, object>()

const turnOf = (client: object): object => {
	const known = turns.get(client)
	if (known) {
		return known
	}
	const fresh = {}
	turns.set(client, fresh)
	return fresh
}

/**
 * Main thread's driver, one statement per event loop turn, so chains of short statements never
 * run as one long stall. A transaction yields once it ends: mid-way, host writes wait on its lock.
 */
const yielding = (driver: SqlDriver, client: object): SqlDriver => {
	const gate = turnOf(client)
	const turn = <T>(work: () => Promise<T>): Promise<T> =>
		exclusive(gate, async () => {
			try {
				return await work()
			} finally {
				await yieldToLoop()
			}
		})
	return {
		run: (text, values, options) => turn(() => driver.run(text, values, options)),
		write: (text, values) => turn(() => driver.write(text, values)),
		batch: (statements, options) => turn(() => driver.batch(statements, options)),
		transaction: async (work, options) => {
			const result = await driver.transaction(work, options)
			await yieldToLoop()
			return result
		},
	}
}

/** A driver that knows, once it decided, whether its statements hold up this thread. */
export interface ThreadedDriver extends SqlDriver {
	/** Whether a statement holds this thread until it ends: SQLite on the main thread. */
	blocking(): Promise<boolean>
	/** Lets go of the worker threads, which stop once nothing else holds them. */
	close(): Promise<void>
}

export interface SqliteThreadOptions {
	/** The host adapter's own client, on which the main thread runs its statements. */
	client: LibsqlClient
	/** The driver on that client. */
	main: SqlDriver
	/** The adapter's `clientConfig`, which a worker opens its own connection with. */
	clientConfig: unknown
	busyTimeoutMs: number
	adapterBusyTimeoutMs: number
	requested: SqliteThread
	warn: (message: string) => void
	/** Where `@libsql/client` is resolved from; `process.cwd()` by default. */
	cwd?: string
	spawn?: SpawnSqliteWorker
	lanes?: SqliteLaneCount
}

/**
 * A local SQLite file's driver, deciding on its first statement where statements run. Threads are
 * shared by every driver on one client with the same busy timeout, and stop once the last lets go.
 */
export const sqliteThreadDriver = (options: SqliteThreadOptions): ThreadedDriver => {
	const { client } = options
	const main = yielding(options.main, client)
	const config = configOf(options.clientConfig)
	const url = typeof config.url === 'string' ? config.url : undefined
	const cwd = options.cwd ?? process.cwd()
	const pools = sharedOf(client)
	let held: SqliteWorkers | undefined

	const acquire = (clientPath: string): SqliteWorkers => {
		if (destroyed.has(client)) {
			throw new SqliteWorkersClosed()
		}
		const key = JSON.stringify([clientPath, options.busyTimeoutMs, options.lanes ?? null])
		const existing = pools.get(key)
		if (existing) {
			existing.holders += 1
			return existing.workers
		}
		const data: SqliteWorkerData = { clientPath, config, busyTimeoutMs: options.busyTimeoutMs }
		const workers = createSqliteWorkers({
			data,
			...(options.lanes === undefined ? {} : { lanes: options.lanes }),
			...(options.spawn === undefined ? {} : { spawn: options.spawn }),
		})
		pools.set(key, { workers, holders: 1 })
		return workers
	}

	const release = async (workers: SqliteWorkers): Promise<void> => {
		for (const [key, entry] of pools) {
			if (entry.workers !== workers) {
				continue
			}
			entry.holders -= 1
			if (entry.holders <= 0) {
				pools.delete(key)
				await workers.close()
			}
			return
		}
	}

	let deciding: Promise<SqlDriver> | undefined
	let onMain = false

	const decide = (): Promise<SqlDriver> => {
		deciding ??= decideThread(
			{
				requested: options.requested,
				url,
				adapterBusyTimeoutMs: options.adapterBusyTimeoutMs,
				replica: typeof config.syncUrl === 'string' && config.syncUrl !== '',
			},
			{
				journalMode: () => journalModeOf(client),
				resolveClient: () => resolveLibsqlClient(cwd),
				acquire,
				release,
				hostNatives: () => hostLibsqlNatives(cwd),
			}
		).then(
			(decision) => {
				if (decision.thread === 'main') {
					onMain = true
					if (decision.reasons.length > 0) {
						warnOnce(client, options.warn, mainThreadWarning(decision.reasons))
					}
					return main
				}
				held = decision.workers
				if (decision.reasons.length > 0) {
					warnOnce(client, options.warn, forcedWorkerWarning(decision.reasons))
				}
				return decision.workers.driver
			},
			(err: unknown) => {
				// A failure to even ask the database is tried again by the next statement.
				if (!(err instanceof SqliteThreadUnavailable)) {
					deciding = undefined
				}
				throw err
			}
		)
		return deciding
	}

	return {
		run: async (text, values, runOptions) => (await decide()).run(text, values, runOptions),
		write: async (text, values) => (await decide()).write(text, values),
		batch: async (statements, batchOptions) => (await decide()).batch(statements, batchOptions),
		transaction: async (work, transactionOptions) =>
			(await decide()).transaction(work, transactionOptions),
		blocking: async () => {
			await decide()
			return onMain
		},
		close: async () => {
			const workers = held
			held = undefined
			deciding = undefined
			onMain = false
			if (workers) {
				await release(workers)
			}
		},
	}
}
