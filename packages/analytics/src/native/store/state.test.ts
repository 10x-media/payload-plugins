import { describe, expect, it } from 'vitest'
import { chunksOf } from './chunks'
import {
	atOf,
	dayEnd,
	dayFinalAfter,
	dayKey,
	daysFrom,
	epochStateKey,
	heartbeatKey,
	heartbeatStale,
	leaseKey,
	leaseUntilFrom,
	markerOf,
	openDueBy,
	saltExpiresAt,
	saltKey,
	stateKindOf,
} from './state'

const MINUTE = 60_000

describe('state keys', () => {
	it('names every row the way the engine design reads them', () => {
		expect(saltKey(20261005)).toBe('salt:2026-10-05')
		expect(dayKey('tenant-a', 20261005)).toBe('day:tenant-a:20261005')
		expect(dayKey('', 20261005)).toBe('day::20261005')
		expect(leaseKey('maintain')).toBe('lease:maintain')
		expect(heartbeatKey('analytics-maintain')).toBe('heartbeat:analytics-maintain')
		expect(epochStateKey('tenant-a')).toBe('epoch:tenant-a')
		expect(epochStateKey('')).toBe('epoch:')
	})

	it('reads a key’s kind from its prefix alone, whatever its scope holds', () => {
		expect(stateKindOf('salt:2026-10-05')).toBe('salt')
		expect(stateKindOf('day:a:b:20261005')).toBe('day')
		expect(stateKindOf('day::20261005')).toBe('day')
		expect(stateKindOf('lease:maintain')).toBe('lease')
		expect(stateKindOf('heartbeat:analytics-sync')).toBe('heartbeat')
		expect(stateKindOf('epoch:tenant-a')).toBe('epoch')
		for (const key of ['', 'lease', ':lease', 'leases:x', 'Day:x:20261005']) {
			expect(stateKindOf(key), key).toBeUndefined()
		}
	})
})

describe('state timing', () => {
	const now = new Date('2026-10-06T12:00:00.000Z')

	it('sets a lease to expire its duration from now, and refuses a duration of nothing', () => {
		expect(leaseUntilFrom(now, 10 * MINUTE).toISOString()).toBe('2026-10-06T12:10:00.000Z')
		for (const ttl of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(() => leaseUntilFrom(now, ttl), String(ttl)).toThrow(RangeError)
		}
	})

	it('ends a day at the next day’s start in its own zone, a DST day included', () => {
		expect(dayEnd(20261005, 'UTC').toISOString()).toBe('2026-10-06T00:00:00.000Z')
		expect(dayEnd(20261005, 'Asia/Kolkata').toISOString()).toBe('2026-10-05T18:30:00.000Z')
		// New York falls back on 2026-11-01, a day of 25 hours.
		expect(dayEnd(20261101, 'America/New_York').toISOString()).toBe('2026-11-02T05:00:00.000Z')
	})

	it('finalizes a day a day and a quarter hour after it ends', () => {
		expect(dayFinalAfter(20261005, 'UTC').toISOString()).toBe('2026-10-07T00:15:00.000Z')
		expect(dayFinalAfter(20261101, 'America/New_York').toISOString()).toBe(
			'2026-11-03T05:15:00.000Z'
		)
	})

	it('makes an open day due a quarter hour after it ends', () => {
		const end = dayEnd(20261005, 'America/New_York')
		const finalAfter = dayFinalAfter(20261005, 'America/New_York')
		const settled = new Date(end.getTime() + 15 * MINUTE)
		expect(finalAfter <= openDueBy(settled)).toBe(true)
		expect(finalAfter <= openDueBy(new Date(settled.getTime() - 1))).toBe(false)
	})

	it('expires a salt when the third UTC day after its own begins', () => {
		expect(saltExpiresAt(20261005).toISOString()).toBe('2026-10-08T00:00:00.000Z')
		expect(saltExpiresAt(20261230).toISOString()).toBe('2027-01-02T00:00:00.000Z')
	})

	it('calls a heartbeat stale once it is more than two intervals old, or missing', () => {
		const interval = 15 * MINUTE
		expect(heartbeatStale(null, interval, now)).toBe(true)
		expect(heartbeatStale(new Date(now.getTime() - 30 * MINUTE), interval, now)).toBe(false)
		expect(heartbeatStale(new Date(now.getTime() - 30 * MINUTE - 1), interval, now)).toBe(true)
	})
})

describe('state values', () => {
	it('lists every date of a range, across a month and a year', () => {
		expect(daysFrom(20261230, 20270102)).toEqual([20261230, 20261231, 20270101, 20270102])
		expect(daysFrom(20261005, 20261005)).toEqual([20261005])
		expect(daysFrom(20261006, 20261005)).toEqual([])
	})

	it('reads the instant a heartbeat or prune record keeps', () => {
		const iso = '2026-10-06T12:00:00.000Z'
		expect(atOf({ at: iso })?.toISOString()).toBe(iso)
		expect(atOf('nope')).toBeNull()
	})

	it('reads a marker from a row in either driver’s types, and nothing from a partial row', () => {
		expect(
			markerOf({
				scope: 'a',
				day: '20261005',
				tz: 'UTC',
				status: 'provisional',
				version: '1',
				gen: 'run-1',
				hits: 7,
				leaseOwner: null,
				leaseUntil: null,
				finalAfter: '2026-10-07T00:15:00.000Z',
				aggregatedAt: new Date('2026-10-06T00:20:00.000Z'),
			})
		).toEqual({
			scope: 'a',
			day: 20261005,
			tz: 'UTC',
			start: null,
			status: 'provisional',
			version: 1,
			gen: 'run-1',
			hits: 7,
			leaseOwner: null,
			leaseUntil: null,
			finalAfter: new Date('2026-10-07T00:15:00.000Z'),
			aggregatedAt: new Date('2026-10-06T00:20:00.000Z'),
		})
		expect(markerOf({ scope: 'a', day: 20261005, tz: 'UTC', status: 'closed' })).toBeNull()
		expect(markerOf({ scope: 'a', tz: 'UTC', status: 'open' })).toBeNull()
	})

	it('splits keys into statements of a bounded size, in order', () => {
		expect(chunksOf([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
		expect(chunksOf([], 500)).toEqual([])
		expect(() => chunksOf([1], 0)).toThrow(RangeError)
	})
})
