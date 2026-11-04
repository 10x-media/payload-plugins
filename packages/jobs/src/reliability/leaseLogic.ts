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
