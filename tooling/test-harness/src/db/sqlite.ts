import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type SQLiteAdapter, type SQLiteAdapterArgs, sqliteAdapter } from '@payloadcms/db-sqlite'

export interface SqliteTestDb {
	adapter: ReturnType<typeof sqliteAdapter>
	stop: () => Promise<void>
	connectionString: string
}

/** How long a write waits for another connection's lock, on every connection the client opens. */
export const SQLITE_TEST_BUSY_TIMEOUT_MS = 5_000

type LibsqlClient = SQLiteAdapter['client']

/** libsql's `TransactionMode`, whose package the harness does not depend on directly. */
type TransactionMode = 'write' | 'read' | 'deferred'

const KEPT = Symbol.for('@10x-media/payload-test-harness/busy-timeout')

/**
 * Keeps `busy_timeout` on every connection a local libsql client opens. libsql 0.14's
 * `transaction()` hands the client's connection to the transaction and opens the next one without
 * the pragma Payload ran once at connect, so from the second transaction on, `BEGIN IMMEDIATE`
 * fails at once with SQLITE_BUSY while another connection holds the write lock. The pragma is run
 * right after each handover, which opens the replacement with it. Idempotent per client.
 */
export const keepBusyTimeout = (client: LibsqlClient, ms: number): void => {
	if (client.protocol !== 'file' || Reflect.get(client, KEPT) === true) {
		return
	}
	Reflect.set(client, KEPT, true)
	const transaction = client.transaction.bind(client)
	client.transaction = (mode?: TransactionMode) => {
		// Both libsql calls run synchronously up to their first await, so the replacement has the
		// timeout before any other caller can begin a transaction on it.
		const begun = transaction(mode)
		const restored = client.execute(`PRAGMA busy_timeout = ${ms}`).catch(() => undefined)
		return begun.then(async (tx) => {
			await restored
			return tx
		})
	}
}

/**
 * WAL, so readers never wait on the writer, and a busy timeout on every connection libsql opens,
 * the ones its transactions hand over included (`keepBusyTimeout`), so `transactionOptions` (which
 * `extra` may add, and Payload leaves off by default) waits for a lock as Payload's first
 * connection does. Both instances of an `attachTo` pair use it.
 */
export const sqliteTestAdapter = (
	connectionString: string,
	extra: Omit<Partial<SQLiteAdapterArgs>, 'client'> = {}
): ReturnType<typeof sqliteAdapter> => {
	const adapter = sqliteAdapter({
		...extra,
		client: { url: connectionString },
		wal: true,
		busyTimeout: SQLITE_TEST_BUSY_TIMEOUT_MS,
	})
	return {
		...adapter,
		init: (args) => {
			const db = adapter.init(args)
			const connect = db.connect
			if (connect) {
				db.connect = async (options) => {
					await connect.call(db, options)
					keepBusyTimeout(db.client, SQLITE_TEST_BUSY_TIMEOUT_MS)
				}
			}
			return db
		},
	}
}

/**
 * One libsql file per boot, in a temp directory of its own. `stop()` removes the directory
 * with the database and its WAL files; `bootPayload` closes the boot's client before calling it,
 * because the client belongs to the Payload instance rather than to this handle.
 */
export const startSqlite = async (): Promise<SqliteTestDb> => {
	const dir = await mkdtemp(join(tmpdir(), 'payload-test-sqlite-'))
	const connectionString = `file:${join(dir, 'payload.db')}`
	return {
		adapter: sqliteTestAdapter(connectionString),
		connectionString,
		stop: async () => {
			await rm(dir, { recursive: true, force: true })
		},
	}
}
