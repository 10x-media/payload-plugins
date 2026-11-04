/** A minimal store for at-most-once side-effect guarding, keyed by a stable idempotency key. */
export interface IdempotencyStore {
	/** True if `key` was already marked done. */
	has: (key: string) => Promise<boolean>
	/** Mark `key` done. Ideally written in the same transaction as the side effect. */
	mark: (key: string) => Promise<void>
}

/**
 * Wrap a job handler so its side effect runs at most once per idempotency key, even
 * when at-least-once delivery re-runs the job. The race this guards is not only
 * redelivery: when Payload reclaims a job whose lease lapsed while it was still
 * running (a stalled worker that missed its renewals), the original execution cannot
 * be aborted (Payload only fences its writes, the handler keeps going), so a second
 * worker can run the handler concurrently with the first. Key on the
 * stable unit of work, never the job id, so both executions resolve to the same key.
 * The check and the mark are the caller's to make transactional (Payload's queue and
 * the app data share one database, which makes that natural); this helper only
 * sequences them around the handler. A skipped run returns `{ output: {} }`.
 */
export const withIdempotencyKey = <A>(
	handler: (args: A) => Promise<unknown>,
	idem: { keyFor: (args: A) => string; store: IdempotencyStore }
): ((args: A) => Promise<unknown>) => {
	return async (args: A): Promise<unknown> => {
		const key = idem.keyFor(args)
		if (await idem.store.has(key)) {
			return { output: {} }
		}
		const out = await handler(args)
		await idem.store.mark(key)
		return out
	}
}
