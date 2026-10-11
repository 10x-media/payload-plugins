import { Worker } from 'node:worker_threads'
import { isRecord } from '../../../core/values'
import { yieldToLoop } from '../chunks'
import {
	type BatchOutcome,
	type DriverResult,
	exclusive,
	type LibsqlStatement,
	type ReadKind,
	rowsOf,
	type SqlDriver,
	statementOf,
} from './drivers'
import { SQLITE_WORKER_SOURCE } from './sqliteWorkerSource'

/** The plain values of the adapter's client config. */
export type ClientConfig = Readonly<Record<string, string | number | boolean>>

/** What a worker thread starts from: all it needs to open its own connection to the database. */
export interface SqliteWorkerData {
	/** `@libsql/client`'s CommonJS entry, as an absolute path. */
	clientPath: string
	/** The adapter's `client` config, its plain values alone: a function cannot cross threads. */
	config: ClientConfig
	busyTimeoutMs: number
}

/** Starts one thread. Tests hand in their own, to reach the thread they stop. */
export type SpawnSqliteWorker = (data: SqliteWorkerData) => Worker

export const spawnSqliteWorker: SpawnSqliteWorker = (data) =>
	new Worker(SQLITE_WORKER_SOURCE, { eval: true, workerData: data, execArgv: [] })

/** What a thread reports once its connection is open. */
export interface SqliteWorkerReady {
	journalMode: string | null
	/** The libsql native libraries the thread loaded, by their real paths. */
	natives: string[]
}

/** A driver error raised on a worker thread, rebuilt with the codes the error checks read. */
class SqliteThreadError extends Error {
	readonly code: string | undefined
	readonly rawCode: number | undefined
	readonly extendedCode: string | undefined

	constructor(
		fields: {
			name?: string
			message: string
			code?: string
			rawCode?: number
			extendedCode?: string
		},
		cause?: Error
	) {
		super(fields.message, cause ? { cause } : undefined)
		this.name = fields.name ?? 'Error'
		this.code = fields.code
		this.rawCode = fields.rawCode
		this.extendedCode = fields.extendedCode
	}
}

const MAX_CAUSES = 4

/** A string field of what a thread posted, undefined when it holds anything else. */
const stringField = (value: unknown): string | undefined =>
	typeof value === 'string' ? value : undefined

/** An error as a worker thread described it, its `cause` chain included. */
export const threadErrorOf = (described: unknown, depth = 0): Error => {
	if (!isRecord(described)) {
		return new SqliteThreadError({ message: String(described) })
	}
	const cause =
		depth < MAX_CAUSES && described.cause !== undefined
			? threadErrorOf(described.cause, depth + 1)
			: undefined
	return new SqliteThreadError(
		{
			name: stringField(described.name),
			message: stringField(described.message) ?? 'the SQLite worker thread failed',
			code: stringField(described.code),
			rawCode: typeof described.rawCode === 'number' ? described.rawCode : undefined,
			extendedCode: stringField(described.extendedCode),
		},
		cause
	)
}

const readyOf = (value: unknown): SqliteWorkerReady => {
	const ready = isRecord(value) ? value : {}
	return {
		journalMode: stringField(ready.journalMode) ?? null,
		natives: Array.isArray(ready.natives)
			? ready.natives.filter((path): path is string => typeof path === 'string')
			: [],
	}
}

type BatchStatement = LibsqlStatement & { expect?: number }

type Request =
	| ({ op: 'execute' | 'write' } & LibsqlStatement)
	| { op: 'stage'; batch: number; statements: BatchStatement[] }
	| { op: 'batch'; staged?: number; statements: BatchStatement[] }
	| { op: 'begin'; idleMs: number }
	| ({ op: 'tx'; tx: number } & LibsqlStatement)
	| { op: 'commit' | 'rollback'; tx: number }
	| { op: 'close' }

/** An answer whose first rows came ahead in parts, whole again. */
const withRowsAhead = (value: unknown, ahead: unknown[]): unknown =>
	isRecord(value) && Array.isArray(value.rows)
		? { ...value, rows: [...ahead, ...value.rows] }
		: value

interface Waiter {
	resolve: (value: unknown) => void
	reject: (error: Error) => void
}

/** One started thread and the requests it has yet to answer. */
interface Started {
	worker: Worker
	ready: Promise<SqliteWorkerReady>
	waiting: Map<number, Waiter>
	/** Rows of answers still arriving in parts, by request. */
	parts: Map<number, unknown[]>
}

/** One worker thread, started on first use and again whenever the one before stopped. */
interface Lane {
	request(message: Request): Promise<unknown>
	ready(): Promise<SqliteWorkerReady>
	close(): Promise<void>
}

/** A request its thread did not answer in time; that thread finishes alone and a new one starts. */
export class SqliteRequestTimeout extends Error {}

/** The threads were closed for good, with the Payload instance they served. */
export class SqliteWorkersClosed extends Error {
	constructor() {
		super('analytics: the SQLite worker threads were closed with the Payload instance they served')
	}
}

/**
 * A thread is never terminated mid-statement (libsql aborts the process): a closing thread, or one
 * that missed a request's deadline, is asked to close once idle and stopped then.
 */
const createLane = (
	data: SqliteWorkerData,
	spawn: SpawnSqliteWorker,
	requestTimeoutMs: number
): Lane => {
	let current: Started | undefined
	let sequence = 0
	let closed = false

	/** A thread nobody waits on keeps no process alive. */
	const idle = (started: Started): void => {
		if (started.waiting.size === 0) {
			started.worker.unref()
		}
	}

	const failAll = (started: Started, error: Error): void => {
		for (const waiter of started.waiting.values()) {
			waiter.reject(error)
		}
		started.waiting.clear()
	}

	const start = (): Started => {
		const worker = spawn(data)
		let settle: Waiter = { resolve: () => undefined, reject: () => undefined }
		const ready = new Promise<SqliteWorkerReady>((resolve, reject) => {
			settle = { resolve: (value) => resolve(readyOf(value)), reject }
		})
		ready.catch(() => undefined)
		const started: Started = { worker, ready, waiting: new Map(), parts: new Map() }
		current = started
		worker.on('message', (message: unknown) => {
			if (!isRecord(message)) {
				return
			}
			if ('ready' in message) {
				settle.resolve(message.ready)
				idle(started)
				return
			}
			if ('failed' in message) {
				settle.reject(threadErrorOf(message.failed))
				if (current === started) {
					current = undefined
				}
				void worker.terminate()
				return
			}
			const id = message.id
			const waiter = typeof id === 'number' ? started.waiting.get(id) : undefined
			if (!waiter || typeof id !== 'number') {
				return
			}
			if (!('ok' in message)) {
				if (Array.isArray(message.rows)) {
					const held = started.parts.get(id) ?? []
					held.push(...message.rows)
					started.parts.set(id, held)
				}
				return
			}
			started.waiting.delete(id)
			const ahead = started.parts.get(id)
			started.parts.delete(id)
			if (message.ok === true) {
				waiter.resolve(ahead ? withRowsAhead(message.value, ahead) : message.value)
			} else {
				waiter.reject(threadErrorOf(message.error))
			}
			idle(started)
		})
		worker.on('error', (error: Error) => {
			settle.reject(error)
			failAll(started, error)
		})
		worker.on('exit', (code: number) => {
			const stopped = new Error(`analytics: the SQLite worker thread stopped (exit code ${code})`)
			settle.reject(stopped)
			if (current === started) {
				current = undefined
			}
			failAll(started, stopped)
		})
		return started
	}

	/** Posts a request, answered or failed by `timeoutMs` when it has one. */
	const post = (started: Started, message: Request, timeoutMs: number | null): Promise<unknown> =>
		new Promise((resolve, reject) => {
			sequence += 1
			const id = sequence
			const timer =
				timeoutMs === null
					? undefined
					: setTimeout(() => {
							if (started.waiting.has(id)) {
								setAside(
									started,
									new SqliteRequestTimeout(
										`analytics: the SQLite worker thread did not answer within ${timeoutMs} ms`
									)
								)
							}
						}, timeoutMs)
			timer?.unref?.()
			started.waiting.set(id, {
				resolve: (value) => {
					clearTimeout(timer)
					resolve(value)
				},
				reject: (error) => {
					clearTimeout(timer)
					reject(error)
				},
			})
			started.worker.ref()
			started.worker.postMessage({ ...message, id })
		})

	/** Fails what a thread was asked and sends later requests to a new one; it closes once idle. */
	const setAside = (started: Started, error: Error): void => {
		if (current === started) {
			current = undefined
		}
		failAll(started, error)
		started.parts.clear()
		void post(started, { op: 'close' }, null).then(
			() => started.worker.terminate(),
			() => undefined
		)
		started.worker.unref()
	}

	const running = async (): Promise<Started> => {
		if (closed) {
			throw new SqliteWorkersClosed()
		}
		const started = current ?? start()
		await started.ready
		if (current !== started) {
			throw new Error('analytics: the SQLite worker thread stopped while it started')
		}
		return started
	}

	return {
		async request(message) {
			return post(await running(), message, requestTimeoutMs)
		},
		async ready() {
			return (await running()).ready
		},
		async close() {
			closed = true
			const started = current
			if (!started) {
				return
			}
			current = undefined
			// Answered, or failed, only once the thread finished what it was asked: it is idle now.
			await started.ready.then(() => post(started, { op: 'close' }, null)).catch(() => undefined)
			await started.worker.terminate()
		},
	}
}

/**
 * How many threads run the statements: one runs them all; two keep writes and short reads apart
 * from reads that grow with the hits; three also give a day's count a thread of its own.
 */
export type SqliteLaneCount = 1 | 2 | 3

type Work = 'write' | ReadKind

const LAYOUTS: Record<SqliteLaneCount, (work: Work) => number> = {
	1: () => 0,
	2: (work) => (work === 'long' || work === 'count' ? 1 : 0),
	3: (work) => (work === 'long' ? 1 : work === 'count' ? 2 : 0),
}

/** How long a transaction may idle between its statements before its thread rolls it back. */
const TRANSACTION_IDLE_MS = 60_000

/** How long any request waits for its thread: past a day's lease, a thread is taken as stuck. */
const REQUEST_TIMEOUT_MS = 15 * 60_000

export interface SqliteWorkers {
	/** Statements on the threads: writes and transactions one at a time, on the first. */
	readonly driver: SqlDriver
	/** The first thread's connection open, or why not; the other threads start on first use. */
	ready(): Promise<SqliteWorkerReady>
	/** Stops every thread once it has finished what it was asked; later statements are refused. */
	close(): Promise<void>
}

const resultOf = (value: unknown): DriverResult =>
	isRecord(value)
		? {
				rows: rowsOf(value.rows),
				rowCount: typeof value.rowCount === 'number' ? value.rowCount : 0,
			}
		: { rows: [], rowCount: 0 }

/** Values one message carries at most, so cloning it never holds this thread for long. */
const MESSAGE_VALUES = 40_000

/** A batch's statements in parts of at most `MESSAGE_VALUES` values, each part one message. */
const partsOf = (statements: readonly BatchStatement[]): BatchStatement[][] => {
	const parts: BatchStatement[][] = []
	let part: BatchStatement[] = []
	let values = 0
	for (const each of statements) {
		if (part.length > 0 && values + each.args.length > MESSAGE_VALUES) {
			parts.push(part)
			part = []
			values = 0
		}
		part.push(each)
		values += each.args.length
	}
	if (part.length > 0) {
		parts.push(part)
	}
	return parts
}

/** A batch as its thread answered it. */
const outcomeOf = (value: unknown): BatchOutcome => {
	const answered = isRecord(value) ? value : {}
	const results = Array.isArray(answered.results) ? answered.results.map(resultOf) : []
	return answered.committed === false && typeof answered.failedAt === 'number'
		? { committed: false, failedAt: answered.failedAt, results }
		: { committed: true, results }
}

/**
 * SQLite statements on worker threads, each with its own connection, so a long statement holds up
 * no request. This process's writes queue here and wait out other locks off this thread.
 */
export const createSqliteWorkers = (args: {
	data: SqliteWorkerData
	lanes?: SqliteLaneCount
	spawn?: SpawnSqliteWorker
	/** How long a request waits for its thread's answer; `REQUEST_TIMEOUT_MS` by default. */
	requestTimeoutMs?: number
}): SqliteWorkers => {
	const count = args.lanes ?? 3
	const spawn = args.spawn ?? spawnSqliteWorker
	const timeoutMs = args.requestTimeoutMs ?? REQUEST_TIMEOUT_MS
	const lanes = Array.from({ length: count }, () => createLane(args.data, spawn, timeoutMs))
	const laneFor = (work: Work): Lane => {
		const lane = lanes[LAYOUTS[count](work)] ?? lanes[0]
		if (!lane) {
			throw new Error('analytics: the SQLite worker threads have no lane')
		}
		return lane
	}
	const writes = laneFor('write')
	const queue = {}
	let staging = 0
	const driver: SqlDriver = {
		run: async (text, values, { kind = 'short' } = {}) =>
			resultOf(await laneFor(kind).request({ op: 'execute', ...statementOf(text, values) })),
		write: (text, values) =>
			exclusive(queue, async () =>
				resultOf(await writes.request({ op: 'write', ...statementOf(text, values) }))
			),
		batch: (statements) =>
			exclusive(queue, async () => {
				const parts = partsOf(
					statements.map((each) => ({
						...statementOf(each.text, each.values),
						...(each.expect === undefined ? {} : { expect: each.expect }),
					}))
				)
				const last = parts.pop() ?? []
				staging += 1
				const staged = staging
				// Each part cloned in a slice of its own; the thread takes the lock once it holds them all.
				for (const part of parts) {
					await writes.request({ op: 'stage', batch: staged, statements: part })
					await yieldToLoop()
				}
				return outcomeOf(
					await writes.request({
						op: 'batch',
						...(parts.length > 0 ? { staged } : {}),
						statements: last,
					})
				)
			}),
		// Holds the lock across round trips to this thread, which a host write blocked on that lock
		// would stall until its busy timeout: the engine's own writes go through `batch`.
		transaction: (work, options) =>
			exclusive(queue, async () => {
				const tx = await writes.request({
					op: 'begin',
					idleMs: options.idleTimeoutMs ?? TRANSACTION_IDLE_MS,
				})
				if (typeof tx !== 'number') {
					throw new Error('analytics: the SQLite worker thread began no transaction')
				}
				try {
					const result = await work({
						run: async (text, values) =>
							resultOf(await writes.request({ op: 'tx', tx, ...statementOf(text, values) })),
					})
					await writes.request({ op: 'commit', tx })
					return result
				} catch (err) {
					await writes.request({ op: 'rollback', tx }).catch(() => undefined)
					throw err
				}
			}),
	}
	return {
		driver,
		ready: () => writes.ready(),
		close: async () => {
			await Promise.all(lanes.map((lane) => lane.close()))
		},
	}
}
