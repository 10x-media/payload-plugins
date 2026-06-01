import type { ResolvedReliabilityOptions } from './options'

/**
 * When `reliability.requireConcurrencyControl` is set, refuse to start unless
 * Payload's own `jobs.enableConcurrencyControl` is on. The at-least-once contract
 * relies on it for app-level mutual exclusion under multi-node, and enabling it
 * changes the jobs schema (adds a `concurrencyKey` field), so we fail loudly rather
 * than silently mutate the adopter's schema. The config parameter is a structural
 * subset (Payload's `Config` satisfies it), which keeps the function trivial to unit
 * test with a plain object literal.
 */
export const enforceConcurrencyControl = (
	config: { jobs?: { enableConcurrencyControl?: boolean } },
	options: ResolvedReliabilityOptions
): void => {
	if (!options.requireConcurrencyControl) {
		return
	}
	if (config.jobs?.enableConcurrencyControl === true) {
		return
	}
	throw new Error(
		'@10x-media/jobs: reliability.requireConcurrencyControl is set but jobs.enableConcurrencyControl is not true. ' +
			'Enable it in your Payload config (it adds a concurrencyKey field, so run a migration) or unset requireConcurrencyControl.'
	)
}

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
 * redelivery: when the sweeper requeues a job whose lease expired while it was still
 * running, the original execution cannot be aborted (Payload exposes no AbortSignal),
 * so a second worker can run the handler concurrently with the first. Key on the
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
