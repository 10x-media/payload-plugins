// biome-ignore-all lint/plugin/noProcessEnv: SQLite thread mode override (ANALYTICS_SQLITE_THREAD)
import type { Payload } from 'payload'
import { isRecord } from '../../../core/values'
import { dbKind } from '../../../db/kind'
import { afterDestroy } from '../../../plugin/destroy'
import { mapInSlices } from '../chunks'
import { postgresDialect, type SqlDialect, sqliteDialect } from '../dialect'
import {
	type BatchOutcome,
	type DriverResult,
	type DriverSession,
	isLibsqlClient,
	isPgPool,
	libsqlDriver,
	pgDriver,
	type ReadKind,
	type SqlRow,
	type TransactionOptions,
} from './drivers'
import { compile, raw, type SqlFragment } from './fragment'
import { closeOwnConnection, type OwnConnectionDeps, ownConnectionFor } from './ownConnection'
import {
	closeSqliteWorkers,
	configOf,
	isSqliteThread,
	SQLITE_THREAD_ENV,
	SQLITE_THREADS,
	type SqliteThread,
	sqliteThreadDriver,
	type ThreadedDriver,
} from './sqliteThread'
import type { SpawnSqliteWorker, SqliteLaneCount } from './sqliteWorker'

export type { BatchOutcome, ReadKind, SqlRow } from './drivers'

/** Statements on the database, or inside one transaction. */
export interface SqlSession {
	readonly dialect: SqlDialect
	/**
	 * A read; `kind` says how long it can run (see `ReadKind`), `short` by default, and `signal`
	 * drops it while it still waits for a connection.
	 */
	select(statement: SqlFragment, kind?: ReadKind, signal?: AbortSignal): Promise<SqlRow[]>
	/** A write; `rowCount` is how many rows it changed. */
	execute(statement: SqlFragment): Promise<DriverResult>
}

export interface SqlExecutor extends SqlSession {
	/** A collection's table, quoted, and schema-qualified when the adapter has a `schemaName`. */
	table(slug: string): SqlFragment
	/** Runs `work` in one transaction, committed when it resolves and rolled back when it throws. */
	transaction<T>(work: (tx: SqlSession) => Promise<T>, options?: TransactionOptions): Promise<T>
	/**
	 * Writes in one transaction that never waits on this thread between statements, all or none. A
	 * statement whose `expect`ed row count differs rolls the batch back, which answers where.
	 */
	batch(statements: readonly BatchStatement[], options?: TransactionOptions): Promise<BatchOutcome>
	/** Whether a statement holds up this thread until it ends: SQLite on the main thread. */
	blocking(): Promise<boolean>
	/** Lets go of what it started (SQLite's worker threads); a later statement starts it again. */
	close(): Promise<void>
}

/** A statement of a batch, and the rows it must change when that matters. */
export interface BatchStatement {
	statement: SqlFragment
	expect?: number
}

export interface SqlExecutorOptions {
	/**
	 * How long a SQLite write waits for another connection's lock. Defaults to the adapter's own
	 * `busyTimeout`, or 5 seconds when it set none.
	 */
	busyTimeoutMs?: number
	/**
	 * Where statements on a local SQLite file run; `ANALYTICS_SQLITE_THREAD` when unset, else
	 * `'auto'` (see `SqliteThread`).
	 */
	thread?: SqliteThread
	/** Where the executor's warnings go; the Payload logger by default. */
	warn?: (message: string) => void
	/** Starts a SQLite worker thread: tests hand in their own. */
	spawn?: SpawnSqliteWorker
	/** How the engine opens its own SQLite connections beside the adapter's: tests hand in theirs. */
	ownConnections?: OwnConnectionDeps
	/** SQLite worker threads per database, 3 by default: measurements compare the others. */
	lanes?: SqliteLaneCount
}

const DEFAULT_BUSY_TIMEOUT_MS = 5_000

/** Batch statements compiled per slice of the event loop: a day's can hold a million values. */
const COMPILE_SLICE = 4

const threadFromEnv = (): SqliteThread | undefined => {
	const value = process.env[SQLITE_THREAD_ENV]
	if (value === undefined || value === '') {
		return undefined
	}
	if (!isSqliteThread(value)) {
		throw new Error(
			`analytics: ${SQLITE_THREAD_ENV} must be one of ${SQLITE_THREADS.join(', ')}, got "${value}"`
		)
	}
	return value
}

const NEVER_BLOCKS = {
	blocking: async (): Promise<boolean> => false,
	close: async (): Promise<void> => undefined,
}

/** A slug as Payload's drizzle adapters key their tables (`analytics-hits`, `analytics_hits`). */
export const tableKeyOf = (slug: string): string =>
	slug
		.replace(/([a-z0-9])([A-Z])/g, '$1_$2')
		.replace(/[^A-Za-z0-9]+/g, '_')
		.toLowerCase()

/** The statements that apply a transaction's options on Postgres, right after it begins. */
export const transactionSettings = (dialect: SqlDialect, options: TransactionOptions): string[] => {
	const settings = [
		options.timeoutMs === undefined ? null : dialect.statementTimeout(options.timeoutMs),
		options.lockTimeoutMs === undefined ? null : dialect.lockTimeout(options.lockTimeoutMs),
		options.idleTimeoutMs === undefined ? null : dialect.idleTimeout(options.idleTimeoutMs),
		...(options.analytical ? dialect.analyticalSettings : []),
	]
	return settings.filter((setting) => setting !== null)
}

/**
 * The driver client a Payload SQL adapter holds: db-postgres's `db.pool`, else drizzle's `$client`
 * (db-vercel-postgres, read replicas), or db-sqlite's `db.client`.
 */
const driverOf = (
	payload: Payload,
	dialect: SqlDialect,
	options: SqlExecutorOptions
): ThreadedDriver => {
	const db: object = payload.db
	const drizzle: unknown = Reflect.get(db, 'drizzle')
	const drizzleClient = isRecord(drizzle) ? drizzle.$client : undefined
	if (dialect.name === 'postgres') {
		const pool: unknown = Reflect.get(db, 'pool')
		const candidate = isPgPool(pool) ? pool : drizzleClient
		if (isPgPool(candidate)) {
			return {
				...pgDriver(candidate, (transaction) => transactionSettings(dialect, transaction)),
				...NEVER_BLOCKS,
			}
		}
	} else {
		const own: unknown = Reflect.get(db, 'client')
		const candidate = isLibsqlClient(own) ? own : drizzleClient
		if (isLibsqlClient(candidate)) {
			const adapterTimeout: unknown = Reflect.get(db, 'busyTimeout')
			const adapterBusyTimeoutMs =
				typeof adapterTimeout === 'number' && adapterTimeout > 0 ? adapterTimeout : 0
			const busyTimeoutMs =
				options.busyTimeoutMs ??
				(adapterBusyTimeoutMs > 0 ? adapterBusyTimeoutMs : DEFAULT_BUSY_TIMEOUT_MS)
			if (candidate.protocol !== 'file') {
				return { ...libsqlDriver(candidate, busyTimeoutMs), ...NEVER_BLOCKS }
			}
			const clientConfig: unknown = Reflect.get(db, 'clientConfig')
			const warn = options.warn ?? ((message: string) => payload.logger?.warn(message))
			const threaded = sqliteThreadDriver({
				client: candidate,
				main: libsqlDriver(candidate, busyTimeoutMs, {
					own: ownConnectionFor(candidate, configOf(clientConfig), {
						warn,
						...(options.ownConnections ? { deps: options.ownConnections } : {}),
					}),
				}),
				clientConfig,
				busyTimeoutMs,
				adapterBusyTimeoutMs,
				requested: options.thread ?? threadFromEnv() ?? 'auto',
				warn,
				...(options.spawn === undefined ? {} : { spawn: options.spawn }),
				...(options.lanes === undefined ? {} : { lanes: options.lanes }),
			})
			afterDestroy(payload, candidate, async () => {
				await Promise.all([closeSqliteWorkers(candidate), closeOwnConnection(candidate)])
			})
			return threaded
		}
	}
	throw new Error(
		`analytics: the ${payload.db.name} adapter holds no ${dialect.name} driver client the engine can run SQL on`
	)
}

const sessionOf = (
	dialect: SqlDialect,
	driver: DriverSession,
	write: DriverSession['run']
): SqlSession => ({
	dialect,
	select: async (statement, kind, signal) => {
		const { text, values } = compile(statement, dialect)
		return (
			await driver.run(text, values, {
				...(kind === undefined ? {} : { kind }),
				...(signal === undefined ? {} : { signal }),
			})
		).rows
	},
	execute: (statement) => {
		const { text, values } = compile(statement, dialect)
		return write(text, values)
	},
})

/**
 * Parameterized SQL through the driver client the Payload adapter already opened: no second pool,
 * no adapter import. Tables come from the adapter's own map, so `schemaName` and renames hold.
 */
export const createSqlExecutor = (
	payload: Payload,
	options: SqlExecutorOptions = {}
): SqlExecutor => {
	const kind = dbKind(payload)
	if (kind === 'mongo') {
		throw new Error('analytics: MongoDB has no SQL to run; the engine reads it through its driver')
	}
	const dialect = kind === 'postgres' ? postgresDialect : sqliteDialect
	const driver = driverOf(payload, dialect, options)
	const outside = sessionOf(dialect, driver, (text, values) => driver.write(text, values))
	return {
		...outside,
		table(slug) {
			const tables: unknown = Reflect.get(payload.db, 'tableNameMap')
			const name: unknown = tables instanceof Map ? tables.get(tableKeyOf(slug)) : undefined
			if (typeof name !== 'string') {
				throw new Error(`analytics: the database has no table for the "${slug}" collection`)
			}
			const schema: unknown = Reflect.get(payload.db, 'schemaName')
			return raw(
				dialect.table(name, typeof schema === 'string' && schema !== '' ? schema : undefined)
			)
		},
		transaction: (work, transactionOptions = {}) =>
			driver.transaction(
				(session) => work(sessionOf(dialect, session, (text, values) => session.run(text, values))),
				transactionOptions
			),
		batch: async (statements, batchOptions) =>
			statements.length === 0
				? { committed: true, results: [] }
				: driver.batch(
						await mapInSlices(statements, COMPILE_SLICE, ({ statement, expect }) => ({
							...compile(statement, dialect),
							...(expect === undefined ? {} : { expect }),
						})),
						batchOptions
					),
		blocking: () => driver.blocking(),
		close: () => driver.close(),
	}
}
