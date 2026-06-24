/**
 * A lease is stale (free to acquire/steal) when it has no expiry, or its expiry
 * is strictly before `now`. Strict `<` so a lease is still held exactly at expiry.
 */
export const isLeaseStale = (leaseExpiresAt: Date | null, now: Date): boolean => {
	if (leaseExpiresAt === null) {
		return true
	}
	return leaseExpiresAt.getTime() < now.getTime()
}

/**
 * A privileged write is stale (must be rejected) when its fence token is below the current one.
 */
export const fenceIsStale = (incomingToken: number, currentToken: number): boolean =>
	incomingToken < currentToken

/** The expiry instant for a lease acquired/renewed at `now` for `ttlMs`. */
export const leaseExpiry = (now: Date, ttlMs: number): Date => new Date(now.getTime() + ttlMs)

/**
 * A claimed job is stale (sweepable) when its lease has elapsed (strict `<`, so a
 * job is still live exactly at expiry), or when it has no lease yet but its claim,
 * proxied by `updatedAt` (the claim write bumps it), is older than `fallbackMs`. The
 * second branch recovers a job claimed but crashed before the heartbeat wrapper
 * stamped a lease. Args is an object to stay within the 3-parameter lint cap.
 */
export const isJobStale = (args: {
	leaseExpiresAt: Date | null
	updatedAt: Date
	now: Date
	fallbackMs: number
}): boolean => {
	const { fallbackMs, leaseExpiresAt, now, updatedAt } = args
	if (leaseExpiresAt !== null) {
		return leaseExpiresAt.getTime() < now.getTime()
	}
	return updatedAt.getTime() < now.getTime() - fallbackMs
}
