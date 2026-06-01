import type { LeaseStore } from './leaseStore'
import type { LeaderRole } from './locksCollection'

export type LeaderController = {
	/** Drive one acquire/renew cycle at `now`. Safe to call repeatedly. */
	tick: (now: Date) => Promise<void>
	/** Whether this controller currently holds leadership. */
	isLeader: () => boolean
	/** The fence token of the held lease, or 0 when not leading. */
	fenceToken: () => number
	/** Relinquish leadership now (graceful handoff). */
	release: () => Promise<void>
}

export type LeaderControllerArgs = {
	store: LeaseStore
	role: LeaderRole
	ownerId: string
	ttlMs: number
}

/**
 * Turns a lease into leadership. On each `tick`: if not leading, try to acquire/steal;
 * if leading, renew. A failed renew (the lease was stolen while this node was paused
 * past expiry) drops leadership immediately, so a zombie never keeps acting. No timer
 * lives here; a caller schedules `tick` at `ttlMs / 3`.
 */
export const createLeaderController = (args: LeaderControllerArgs): LeaderController => {
	const { ownerId, role, store, ttlMs } = args
	let leading = false
	let token = 0

	return {
		fenceToken: () => (leading ? token : 0),
		isLeader: () => leading,
		release: async () => {
			await store.release(role, ownerId)
			leading = false
			token = 0
		},
		tick: async (now) => {
			if (leading) {
				const renewed = await store.renew(role, ownerId, ttlMs, now)
				if (!renewed.ok) {
					leading = false
					token = 0
				}
				return
			}
			const acquired = await store.acquireOrSteal(role, ownerId, ttlMs, now)
			if (acquired.ok) {
				leading = true
				token = acquired.fenceToken
			}
		},
	}
}
