import { describe, expect, it } from 'vitest'

import { fenceIsStale, isLeaseStale, leaseExpiry } from './leaseLogic'

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
