import type { Lease } from '../maintenance/lease'
import type { CacheStore } from './cacheStore'

/** Entries one batch deletes at most. */
export const SWEEP_BATCH = 1_000

/** How long one instance waits between the sweeps it starts on its own. */
export const SWEEP_INTERVAL_MS = 10 * 60_000

/** How long a sweep holds its lease: a sweep that froze lets the next one in after this. */
export const SWEEP_LEASE_MS = 2 * 60_000

/** The name of the lease every sweep takes, `lease:cache-sweep` in `analytics-state`. */
export const SWEEP_LEASE = 'cache-sweep'

/** The most batches one run of `analytics-maintain` deletes. */
export const TASK_SWEEP_BATCHES = 10

export interface SweepReport {
	/**
	 * False when another instance held the lease, or the sweep was left for later, so this one
	 * deleted nothing.
	 */
	ran: boolean
	swept: number
}

export interface CacheSweeper {
	/**
	 * Starts one batch in the background unless this instance started one within the interval or
	 * one is still running. Never rejects: a failure is reported through `warn`.
	 */
	maybeSweep(): void
	/** Sweeps now under the lease, batch after batch while each comes back full, up to `batches`. */
	sweep(batches?: number): Promise<SweepReport>
	/** Settles once the background sweep, if one runs, has finished. */
	idle(): Promise<void>
}

export interface CacheSweeperOptions {
	store: CacheStore
	/**
	 * The lease a sweep runs under, asked for per sweep; undefined sweeps without one. Sweeping is
	 * idempotent, so the lease only keeps two instances from deleting the same rows at once.
	 */
	lease: () => Lease | undefined
	now: () => Date
	warn?: (message: string) => void
	intervalMs?: number
	batch?: number
	/**
	 * Whether to leave this sweep for a later one, asked before its lease: true while its writes
	 * would wait on a lock this process holds (`hostHoldsWriteLock`).
	 */
	deferred?: () => boolean
}

export const createCacheSweeper = (options: CacheSweeperOptions): CacheSweeper => {
	const intervalMs = options.intervalMs ?? SWEEP_INTERVAL_MS
	const batch = options.batch ?? SWEEP_BATCH
	let startedAt: number | undefined
	let running: Promise<void> | undefined

	const sweep = async (batches = 1): Promise<SweepReport> => {
		if (options.deferred?.()) {
			return { ran: false, swept: 0 }
		}
		const lease = options.lease()
		if (lease && !(await lease.claim())) {
			return { ran: false, swept: 0 }
		}
		try {
			let swept = 0
			for (let round = 0; round < batches; round++) {
				const deleted = await options.store.sweep(options.now(), batch)
				swept += deleted
				if (deleted < batch) {
					break
				}
			}
			return { ran: true, swept }
		} finally {
			try {
				await lease?.release()
			} catch (err) {
				options.warn?.(`analytics: releasing the cache sweep lease failed: ${String(err)}`)
			}
		}
	}

	return {
		sweep,
		maybeSweep() {
			const at = options.now().getTime()
			if (running || (startedAt !== undefined && at - startedAt < intervalMs)) {
				return
			}
			startedAt = at
			running = sweep(1)
				.then(() => undefined)
				.catch((err: unknown) => {
					options.warn?.(`analytics: sweeping expired cache entries failed: ${String(err)}`)
				})
				.finally(() => {
					running = undefined
				})
		},
		idle: async () => {
			await running
		},
	}
}
