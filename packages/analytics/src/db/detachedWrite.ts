import type { Payload } from 'payload'
import { exclusive, isLibsqlClient, type LibsqlClient } from '../native/store/sql/drivers'
import { anyTransactionOpen } from './openTransaction'

/** The local SQLite client Payload's adapter writes through; undefined on any other database. */
const localClientOf = (payload: Payload): LibsqlClient | undefined => {
	const client: unknown = Reflect.get(payload.db, 'client')
	return isLibsqlClient(client) && client.protocol === 'file' ? client : undefined
}

/** Whether a write on this instance's local SQLite file would wait on an open host transaction. */
export const hostHoldsWriteLock = (payload: Payload): boolean =>
	localClientOf(payload) !== undefined && anyTransactionOpen(payload)

/**
 * The boot warning for a local SQLite file whose adapter sets `transactionOptions`: @libsql/client
 * 0.14 opens each connection after a transaction without the busy timeout (db-sqlite connect.js).
 */
export const sqliteTransactionsNotice = (payload: Payload): string | null => {
	const options: unknown = Reflect.get(payload.db, 'transactionOptions')
	return localClientOf(payload) && options
		? "analytics: the SQLite adapter sets transactionOptions. @libsql/client opens every connection after a transaction without the adapter's busyTimeout, so from the second transaction on a write fails at once with SQLITE_BUSY while another connection holds the lock (the native engine's, a jobs worker's, another instance's), and libsql may then lose later writes on that connection. Leave transactionOptions unset on SQLite, as Payload does by default."
		: null
}

/**
 * A plugin write outside every request, or `skipped` while a host transaction is open: waiting on
 * this process's own SQLite lock stalls, then fails and leaves libsql losing later writes.
 */
export const detachedWrite = async <T>(
	payload: Payload,
	work: () => Promise<T>,
	skipped: T
): Promise<T> => {
	const client = localClientOf(payload)
	if (!client) {
		return work()
	}
	return exclusive(client, async () => {
		if (hostHoldsWriteLock(payload)) {
			return skipped
		}
		const busyTimeout: unknown = Reflect.get(payload.db, 'busyTimeout')
		if (typeof busyTimeout === 'number' && busyTimeout > 0) {
			await client.execute(`PRAGMA busy_timeout = ${Math.floor(busyTimeout)}`)
		}
		return work()
	})
}
