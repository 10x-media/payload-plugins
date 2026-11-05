import { monotonicMs } from '../../../core/monotonic'
import { hasMethods, isRecord } from '../../../core/values'
import { isSqliteLockFailure } from '../../../db/errors'
import type { SqlParameter } from './fragment'
import { type PoolShare, type PoolWork, poolShareFor } from './poolShare'

export type SqlRow = Record<string, unknown>

/** What a statement answered, the same shape from both drivers. */
export interface DriverResult {
	rows: SqlRow[]
	rowCount: number
}

/**
 * How long a read can run, which picks its SQLite worker thread: `count` a day's count, `long` any
 * other read whose cost grows with the hits, `short` the rest, which runs beside the writes.
 */
export type ReadKind = 'short' | 'long' | 'count'

/** How one statement runs: `short` by default, dropped unrun if `signal` aborts while it queues. */
export interface RunOptions {
	kind?: ReadKind
	signal?: AbortSignal
}

/** Somewhere statements run: the database itself, or one open transaction. */
export interface DriverSession {
	run(text: string, values: readonly SqlParameter[], options?: RunOptions): Promise<DriverResult>
}

/** One statement of a batch, compiled. */
export interface DriverStatement {
	text: string
	values: readonly SqlParameter[]
	/** The rows it must change: any other count rolls the batch back, nothing of it written. */
	expect?: number
}

/** A batch committed whole, or rolled back at the statement whose count was not as expected. */
export type BatchOutcome =
	| { committed: true; results: DriverResult[] }
	| { committed: false; failedAt: number; results: DriverResult[] }

/** Thrown inside a batch's transaction to roll it back, and caught where the batch is answered. */
class BatchRefused extends Error {
	constructor(
		readonly failedAt: number,
		readonly results: DriverResult[]
	) {
		super('analytics: a statement of the batch changed other rows than expected')
	}
}

/** A batch's statements in order on one transaction's session; refused at an unexpected count. */
const runBatch = async (
	session: DriverSession,
	statements: readonly DriverStatement[]
): Promise<DriverResult[]> => {
	const results: DriverResult[] = []
	for (const [index, each] of statements.entries()) {
		const result = await session.run(each.text, each.values)
		results.push(result)
		if (each.expect !== undefined && result.rowCount !== each.expect) {
			throw new BatchRefused(index, results)
		}
	}
	return results
}

/** `run` answered as a batch's outcome: a refusal is an outcome, any other failure is thrown. */
const outcomeOf = async (run: () => Promise<DriverResult[]>): Promise<BatchOutcome> => {
	try {
		return { committed: true, results: await run() }
	} catch (err) {
		if (err instanceof BatchRefused) {
			return { committed: false, failedAt: err.failedAt, results: err.results }
		}
		throw err
	}
}

export interface TransactionOptions {
	/** Statements in the transaction are cancelled past this, where the database can do that. */
	timeoutMs?: number
	/** A statement waiting longer than this for a lock another connection holds fails instead. */
	lockTimeoutMs?: number
	/**
	 * The database ends the session when the transaction sits idle this long between statements, so
	 * a writer that froze mid-transaction cannot keep its locks.
	 */
	idleTimeoutMs?: number
	/** A long read, run under the dialect's `analyticalSettings`. */
	analytical?: boolean
	/** Drops the transaction while it still waits for a connection, where the driver queues one. */
	signal?: AbortSignal
}

export interface SqlDriver extends DriverSession {
	/** Runs one write outside any transaction. */
	write(text: string, values: readonly SqlParameter[]): Promise<DriverResult>
	/**
	 * Runs writes in one transaction, all or none, never waiting on the caller between statements, so
	 * a host write blocking this thread on the same lock cannot stall it.
	 */
	batch(statements: readonly DriverStatement[], options?: TransactionOptions): Promise<BatchOutcome>
	transaction<T>(
		work: (session: DriverSession) => Promise<T>,
		options: TransactionOptions
	): Promise<T>
}

/** The rows a driver answered, each a plain object of its columns; anything else is dropped. */
export const rowsOf = (rows: unknown): SqlRow[] =>
	Array.isArray(rows) ? rows.filter(isRecord).map((row) => ({ ...row })) : []

/** The slice of node-postgres' `Pool` in use here (`@vercel/postgres`' pool mirrors it). */
interface PgResult {
	rows: unknown
	rowCount: number | null
}

interface PgQueryable {
	query(text: string, values: readonly SqlParameter[]): Promise<PgResult>
}

interface PgPoolClient extends PgQueryable {
	release(destroy?: boolean): void
}

export interface PgPool extends PgQueryable {
	connect(): Promise<PgPoolClient>
}

export const isPgPool = (value: unknown): value is PgPool => hasMethods(value, ['query', 'connect'])

const pgResult = (result: PgResult): DriverResult => ({
	rows: rowsOf(result.rows),
	rowCount: result.rowCount ?? 0,
})

const workOf = (kind: ReadKind | undefined): PoolWork =>
	kind === 'long' || kind === 'count' ? 'long' : 'short'

/** A statement timeout is the read's whole time: what it waited for a connection is spent. */
const afterWait = (options: TransactionOptions, waitedMs: number): TransactionOptions =>
	options.timeoutMs === undefined
		? options
		: { ...options, timeoutMs: Math.max(1, Math.ceil(options.timeoutMs - waitedMs)) }

/**
 * Statements on a pool and transactions on one client of it, `settingsOf` sent with `BEGIN` in one
 * round trip; every call keeps to the engine's share of the host's pool (`poolShareFor`).
 */
export const pgDriver = (
	pool: PgPool,
	settingsOf: (options: TransactionOptions) => readonly string[],
	share: PoolShare = poolShareFor(pool)
): SqlDriver => {
	const run = (text: string, values: readonly SqlParameter[], options: RunOptions = {}) =>
		share.run(
			workOf(options.kind),
			async () => pgResult(await pool.query(text, values)),
			options.signal ? { signal: options.signal } : {}
		)
	const onClient = async <T>(
		work: (session: DriverSession) => Promise<T>,
		options: TransactionOptions
	): Promise<T> => {
		const client = await pool.connect()
		let broken = false
		try {
			await client.query(['BEGIN', ...settingsOf(options)].join('; '), [])
			const result = await work({
				run: async (text, values) => pgResult(await client.query(text, values)),
			})
			await client.query('COMMIT', [])
			return result
		} catch (err) {
			// A connection that cannot even roll back is not handed to the next caller.
			await client.query('ROLLBACK', []).catch(() => {
				broken = true
			})
			throw err
		} finally {
			client.release(broken)
		}
	}
	const driver: SqlDriver = {
		run,
		write: (text, values) => run(text, values),
		batch: (statements, options = {}) => {
			const [only] = statements
			return statements.length === 1 && only && only.expect === undefined
				? run(only.text, only.values).then((result) => ({ committed: true, results: [result] }))
				: outcomeOf(() => driver.transaction((session) => runBatch(session, statements), options))
		},
		transaction: (work, options) => {
			const queuedAt = monotonicMs()
			return share.run(
				options.analytical ? 'long' : 'short',
				() => onClient(work, afterWait(options, monotonicMs() - queuedAt)),
				{
					...(options.signal ? { signal: options.signal } : {}),
					...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
				}
			)
		},
	}
	return driver
}

/** The slice of `@libsql/client` in use here. */
interface LibsqlResult {
	rows: unknown
	rowsAffected: number
}

/** A statement as libsql takes it, on this thread or posted to a worker thread. */
export interface LibsqlStatement {
	sql: string
	args: SqlParameter[]
}

interface LibsqlTransaction {
	execute(statement: LibsqlStatement): Promise<LibsqlResult>
	commit(): Promise<void>
	rollback(): Promise<void>
	close(): void
}

export interface LibsqlClient {
	execute(statement: LibsqlStatement | string): Promise<LibsqlResult>
	batch(statements: LibsqlStatement[], mode: 'write'): Promise<LibsqlResult[]>
	transaction(mode: 'write' | 'read' | 'deferred'): Promise<LibsqlTransaction>
	close?(): void
	protocol?: string
}

/** What one of the engine's own connections is for: write transactions, or single statements. */
export type OwnConnectionRole = 'transaction' | 'statement'

/**
 * The engine's own connections (see `ownConnectionFor`): libsql's `transaction()` leaks one per
 * transaction, and a statement failing on the host's connection would leave it unable to commit.
 */
export interface OwnConnection {
	/** The connection for `role`, opened on first use; rejects, every time, when none can be. */
	get(role: OwnConnectionRole): Promise<LibsqlClient>
	/** Closes a connection a statement failed on for a lock, so the next use opens a fresh one. */
	discard(connection: LibsqlClient): void
}

export const isLibsqlClient = (value: unknown): value is LibsqlClient =>
	hasMethods(value, ['execute', 'transaction', 'batch'])

const libsqlResult = (result: LibsqlResult): DriverResult => ({
	rows: rowsOf(result.rows),
	rowCount: result.rowsAffected,
})

export const statementOf = (text: string, values: readonly SqlParameter[]): LibsqlStatement => ({
	sql: text,
	args: [...values],
})

/** The tail of each client's queue of writes, so this process never races itself for the lock. */
const writeQueues = new WeakMap<object, Promise<void>>()

/** Runs `work` once every earlier `work` queued under `key` has settled. */
export const exclusive = async <T>(key: object, work: () => Promise<T>): Promise<T> => {
	const previous = writeQueues.get(key) ?? Promise.resolve()
	let release: () => void = () => undefined
	const done = new Promise<void>((resolve) => {
		release = resolve
	})
	writeQueues.set(
		key,
		previous.then(() => done)
	)
	await previous
	try {
		return await work()
	} finally {
		release()
	}
}

export interface LibsqlDriverOptions {
	/**
	 * Where a local client's statements and write transactions run; else statements on the host's
	 * client and each transaction on a connection libsql hands over.
	 */
	own?: OwnConnection
}

/**
 * libsql opens every connection after the first without a busy timeout, so each write sets it on
 * its connection in the same synchronous tick. Writes queue so this process never waits on itself.
 */
export const libsqlDriver = (
	client: LibsqlClient,
	busyTimeoutMs: number,
	options: LibsqlDriverOptions = {}
): SqlDriver => {
	const local = client.protocol === 'file'
	const pragma = `PRAGMA busy_timeout = ${busyTimeoutMs}`
	/** `work` after the busy timeout, both called in one tick so they land on one connection. */
	const withBusyTimeout = async <T>(
		connection: LibsqlClient,
		work: () => Promise<T>
	): Promise<T> => {
		if (!local) {
			return work()
		}
		const [, result] = await Promise.all([connection.execute(pragma), work()])
		return result
	}
	/**
	 * `attempt` on the engine's own statement connection, closed after a lock failure, after which
	 * libsql would commit nothing more on it; a remote database runs it on the host's client.
	 */
	const onSharedConnection = async <T>(
		attempt: (connection: LibsqlClient) => Promise<T>
	): Promise<T> => {
		const own = local && options.own ? await options.own.get('statement') : null
		try {
			return await attempt(own ?? client)
		} catch (err) {
			if (own && isSqliteLockFailure(err)) {
				options.own?.discard(own)
			}
			throw err
		}
	}
	/**
	 * `work` in a write transaction on the engine's own connection, dropped when a statement fails
	 * for a lock or the rollback fails, either of which leaves it unable to commit.
	 */
	const onOwnConnection = async <T>(
		connection: LibsqlClient,
		work: (session: DriverSession) => Promise<T>
	): Promise<T> => {
		let failed = false
		const execute = async (each: LibsqlStatement | string): Promise<LibsqlResult> => {
			try {
				return await connection.execute(each)
			} catch (err) {
				failed ||= isSqliteLockFailure(err)
				throw err
			}
		}
		try {
			await execute(pragma)
			await execute('BEGIN IMMEDIATE')
			try {
				const result = await work({
					run: async (text, values) => libsqlResult(await execute(statementOf(text, values))),
				})
				await execute('COMMIT')
				return result
			} catch (err) {
				await connection.execute('ROLLBACK').catch(() => {
					failed = true
				})
				throw err
			}
		} finally {
			if (failed) {
				options.own?.discard(connection)
			}
		}
	}
	const onHandedConnection = async <T>(
		work: (session: DriverSession) => Promise<T>
	): Promise<T> => {
		const tx = await withBusyTimeout(client, () => client.transaction('write'))
		try {
			const result = await work({
				run: async (text, values) => libsqlResult(await tx.execute(statementOf(text, values))),
			})
			await tx.commit()
			return result
		} catch (err) {
			await tx.rollback().catch(() => undefined)
			throw err
		} finally {
			tx.close()
		}
	}
	const transaction: SqlDriver['transaction'] = (work) =>
		exclusive(client, async () => {
			const connection = local && options.own ? await options.own.get('transaction') : null
			return connection ? onOwnConnection(connection, work) : onHandedConnection(work)
		})
	return {
		run: (text, values) =>
			onSharedConnection(async (connection) =>
				libsqlResult(await connection.execute(statementOf(text, values)))
			),
		write: (text, values) =>
			exclusive(client, () =>
				onSharedConnection(async (connection) =>
					libsqlResult(
						await withBusyTimeout(connection, () => connection.execute(statementOf(text, values)))
					)
				)
			),
		batch: (statements, options = {}) =>
			statements.some((each) => each.expect !== undefined)
				? outcomeOf(() => transaction((session) => runBatch(session, statements), options))
				: exclusive(client, () =>
						onSharedConnection(async (connection) => {
							const each = statements.map((one) => statementOf(one.text, one.values))
							const results = await withBusyTimeout(connection, () =>
								connection.batch(each, 'write')
							)
							return { committed: true, results: results.map(libsqlResult) }
						})
					),
		transaction,
	}
}
