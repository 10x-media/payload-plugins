import type { Payload } from 'payload'

import type { ResolvedOptions } from '../options'

/**
 * Whether the database opens a transaction, as `initTransaction` asks it: a MongoDB without a
 * replica set, or an adapter given `transactionOptions: false`, answers with none.
 */
export const transactionsOn = async (payload: Payload): Promise<boolean> => {
	const id = await payload.db.beginTransaction()
	if (!id) return false
	await payload.db.rollbackTransaction(id)
	return true
}

/** What the reviewer is told when merging is off: only whoever runs the deployment can act. */
export const MERGING_UNAVAILABLE = 'Merging is not available. Contact your administrator.'

const WHY =
	'the database opens no transactions. On MongoDB, connect to a replica set and name it with `replicaSet` in the connection string; otherwise check that the adapter is not given `transactionOptions: false`.'

/** The technical reason merging is off or unsafe, for the server log. */
export const transactionsMessage = (required: boolean): string =>
	required
		? `[dedupe] merging is off: ${WHY} \`requireTransactions\` is on.`
		: `[dedupe] merges run without a transaction: ${WHY} A merge that fails halfway leaves some steps done.`

/**
 * Logs once at boot when the database opens no transactions: as an error when
 * `requireTransactions` turns merging off, as a warning otherwise. The merge screen tells the
 * reviewer no more than that merging is unavailable.
 */
export const reportTransactions = async (
	payload: Payload,
	options: Pick<ResolvedOptions, 'requireTransactions'>
): Promise<void> => {
	if (await transactionsOn(payload)) return
	const message = transactionsMessage(options.requireTransactions)
	if (options.requireTransactions) payload.logger.error(message)
	else payload.logger.warn(message)
}
