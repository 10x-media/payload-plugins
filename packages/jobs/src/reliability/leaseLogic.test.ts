import { describe, expect, it } from 'vitest'

import { fenceIsStale, isJobStale, isLeaseStale, leaseExpiry } from './leaseLogic'

const now = new Date('2026-01-01T00:00:00.000Z')

describe('isLeaseStale', () => {
	it('treats a null lease as stale (free)', () => {
		expect(isLeaseStale(null, now)).toBe(true)
	})

	it('is stale when expiry is strictly before now', () => {
		expect(isLeaseStale(new Date(now.getTime() - 1), now)).toBe(true)
	})

	it('is NOT stale exactly at expiry (uses strict <)', () => {
		expect(isLeaseStale(new Date(now.getTime()), now)).toBe(false)
	})

	it('is NOT stale when expiry is after now', () => {
		expect(isLeaseStale(new Date(now.getTime() + 1), now)).toBe(false)
	})
})

describe('fenceIsStale', () => {
	it('rejects an incoming token lower than the current token', () => {
		expect(fenceIsStale(1, 2)).toBe(true)
	})

	it('accepts an equal token', () => {
		expect(fenceIsStale(2, 2)).toBe(false)
	})

	it('accepts a higher token', () => {
		expect(fenceIsStale(3, 2)).toBe(false)
	})
})

describe('leaseExpiry', () => {
	it('adds the ttl to now', () => {
		expect(leaseExpiry(now, 30_000).toISOString()).toBe('2026-01-01T00:00:30.000Z')
	})
})

describe('isJobStale', () => {
	const now = new Date('2026-02-01T00:00:00.000Z')

	it('is stale when the lease is in the past', () => {
		expect(
			isJobStale({
				fallbackMs: 300_000,
				leaseExpiresAt: new Date('2026-01-31T23:59:59.000Z'),
				now,
				updatedAt: now,
			})
		).toBe(true)
	})

	it('is not stale when the lease is in the future or exactly now', () => {
		expect(isJobStale({ fallbackMs: 300_000, leaseExpiresAt: now, now, updatedAt: now })).toBe(
			false
		)
		expect(
			isJobStale({
				fallbackMs: 300_000,
				leaseExpiresAt: new Date('2026-02-01T00:00:01.000Z'),
				now,
				updatedAt: now,
			})
		).toBe(false)
	})

	it('falls back to updatedAt age when there is no lease', () => {
		expect(
			isJobStale({
				fallbackMs: 300_000,
				leaseExpiresAt: null,
				now,
				updatedAt: new Date('2026-01-31T23:54:00.000Z'),
			})
		).toBe(true)
		expect(
			isJobStale({
				fallbackMs: 300_000,
				leaseExpiresAt: null,
				now,
				updatedAt: new Date('2026-01-31T23:56:00.000Z'),
			})
		).toBe(false)
	})
})
