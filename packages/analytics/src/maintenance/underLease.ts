/** Work one holder does at a time across every instance, coordinated in `analytics-state`. */
export interface Lease {
	/** True when this holder took it: it was free, had expired, or was already this holder's. */
	claim(): Promise<boolean>
	/** Gives it back before it expires, when this holder still has it. */
	release(): Promise<void>
}

/** What work running under a lease can ask while it runs. */
export interface LeaseHold {
	/** True once a renewal found another holder: the work should stop at its next step. */
	lost(): boolean
}

export type LeaseOutcome<T> = { ran: true; value: T } | { ran: false }

/**
 * Runs `work` under `lease`, renewed every third of `ttlMs`; `{ ran: false }` when another holder
 * has it, unguarded with no lease. A failed renewal retries; only another holder loses the lease.
 */
export const underLease = async <T>(
	options: { lease: Lease | undefined; ttlMs: number; warn: (message: string) => void },
	work: (hold: LeaseHold) => Promise<T>
): Promise<LeaseOutcome<T>> => {
	const { lease, ttlMs, warn } = options
	if (!lease) {
		return { ran: true, value: await work({ lost: () => false }) }
	}
	if (!(await lease.claim())) {
		return { ran: false }
	}
	let lost = false
	const renew = setInterval(
		() => {
			lease.claim().then(
				(still) => {
					lost ||= !still
				},
				(err: unknown) => warn(`analytics: renewing a task's lease failed: ${String(err)}`)
			)
		},
		Math.max(1, Math.floor(ttlMs / 3))
	)
	renew.unref?.()
	try {
		return { ran: true, value: await work({ lost: () => lost }) }
	} finally {
		clearInterval(renew)
		await lease.release().catch((err: unknown) => {
			warn(`analytics: releasing a task's lease failed: ${String(err)}`)
		})
	}
}
