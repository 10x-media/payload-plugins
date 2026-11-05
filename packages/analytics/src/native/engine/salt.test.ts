import { describe, expect, it, vi } from 'vitest'
import type { CalendarDay } from '../../timeframe/calendar'
import { TimezoneResolutionError } from '../../timeframe/reportingTimezone'
import { MAX_REMEMBERED_SCOPES } from './recent'
import { createDailySalts, MAX_CACHED_DAYS, saltForHit } from './salt'

/**
 * A state store answering `salt-<day>` for every day, recording which days it was asked for and
 * the instants it was asked to delete expired salts at.
 */
const fakeState = (fail: (day: CalendarDay) => boolean = () => false, sweepFails = false) => {
	const asked: CalendarDay[] = []
	const sweeps: Date[] = []
	return {
		asked,
		sweeps,
		state: {
			salt: async (day: CalendarDay) => {
				asked.push(day)
				if (fail(day)) {
					throw new Error(`no salt for ${day}`)
				}
				return `salt-${day}`
			},
			sweep: async (at: Date) => {
				sweeps.push(at)
				if (sweepFails) {
					throw new Error('state store down')
				}
				return 0
			},
		},
	}
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('createDailySalts', () => {
	it('fetches a day once, and the next day with it ahead of midnight', async () => {
		const { state, asked } = fakeState()
		const salts = createDailySalts({ state })
		await expect(salts.forDay(20261005)).resolves.toBe('salt-20261005')
		await expect(salts.forDay(20261005)).resolves.toBe('salt-20261005')
		await settle()
		expect(asked).toEqual([20261005, 20261006])
		await expect(salts.forDay(20261006)).resolves.toBe('salt-20261006')
		expect(asked).toEqual([20261005, 20261006])
	})

	it(`keeps at most ${MAX_CACHED_DAYS} days, forgetting the oldest`, async () => {
		const { state, asked } = fakeState()
		const salts = createDailySalts({ state })
		await salts.forDay(20261001)
		await salts.forDay(20261003)
		await salts.forDay(20261005)
		await settle()
		// Six days were loaded (each with its next one); the two oldest are gone.
		asked.length = 0
		await salts.forDay(20261001)
		await salts.forDay(20261005)
		await settle()
		expect(asked).toEqual([20261001, 20261002])
	})

	it('fetches a failed day again rather than keeping its failure', async () => {
		let down = true
		const { state, asked } = fakeState((day) => down && day === 20261005)
		const salts = createDailySalts({ state })
		await expect(salts.forDay(20261005)).rejects.toThrow('no salt for 20261005')
		down = false
		await expect(salts.forDay(20261005)).resolves.toBe('salt-20261005')
		expect(asked.filter((day) => day === 20261005)).toHaveLength(2)
	})

	it('survives the next day failing to be created ahead', async () => {
		const { state } = fakeState((day) => day === 20261006)
		const salts = createDailySalts({ state })
		await expect(salts.forDay(20261005)).resolves.toBe('salt-20261005')
		await settle()
		await expect(salts.forDay(20261006)).rejects.toThrow('no salt for 20261006')
	})

	it('files a hit under the local day of its scope’s zone', async () => {
		const salts = createDailySalts({ state: fakeState().state })
		const at = new Date('2026-10-05T20:00:00.000Z')
		await expect(salts.forHit({ scope: 'in', at, zone: () => 'Asia/Kolkata' })).resolves.toEqual({
			day: 20261006,
			tz: 'Asia/Kolkata',
			salt: 'salt-20261006',
		})
		await expect(
			salts.forHit({ scope: 'ny', at, zone: async () => 'America/New_York' })
		).resolves.toEqual({ day: 20261005, tz: 'America/New_York', salt: 'salt-20261005' })
	})

	it('keeps a scope’s last good zone when its resolver fails, never falling back to UTC', async () => {
		const warn = vi.fn()
		const salts = createDailySalts({ state: fakeState().state, warn })
		const at = new Date('2026-10-05T20:00:00.000Z')
		await salts.forHit({ scope: 'in', at, zone: () => 'Asia/Kolkata' })
		const failing = () => {
			throw new Error('tenant lookup down')
		}
		await expect(salts.forHit({ scope: 'in', at, zone: failing })).resolves.toMatchObject({
			day: 20261006,
			tz: 'Asia/Kolkata',
		})
		await expect(
			salts.forHit({ scope: 'in', at, zone: () => 'Mars/Olympus' })
		).resolves.toMatchObject({ tz: 'Asia/Kolkata' })
		expect(warn).toHaveBeenCalledTimes(1)
		expect(String(warn.mock.calls[0]?.[0])).toContain('tenant lookup down')
	})

	it('throws when a scope with no good zone yet cannot resolve one', async () => {
		const salts = createDailySalts({ state: fakeState().state })
		const at = new Date('2026-10-05T20:00:00.000Z')
		await salts.forHit({ scope: 'in', at, zone: () => 'Asia/Kolkata' })
		await expect(
			salts.forHit({
				scope: 'other',
				at,
				zone: () => Promise.reject(new Error('tenant lookup down')),
			})
		).rejects.toThrow('tenant lookup down')
		await expect(salts.forHit({ scope: 'other', at, zone: () => 'Nowhere/Land' })).rejects.toThrow(
			/not an IANA time zone/
		)
		await expect(
			salts.forHit({ scope: 'other', at, zone: () => 'Nowhere/Land' })
		).rejects.toBeInstanceOf(TimezoneResolutionError)
	})

	it('hashes by the zone a scope’s newest counted day was counted in, in a fresh process', async () => {
		const recorded = vi.fn(async (scope: string) => (scope === 'counted' ? 'Asia/Kolkata' : null))
		const salts = createDailySalts({ state: fakeState().state, recorded })
		const at = new Date('2026-10-05T20:00:00.000Z')
		const failing = () => Promise.reject(new Error('tenant lookup down'))
		await expect(salts.forHit({ scope: 'counted', at, zone: failing })).resolves.toMatchObject({
			day: 20261006,
			tz: 'Asia/Kolkata',
		})
		await salts.forHit({ scope: 'counted', at, zone: failing })
		expect(recorded).toHaveBeenCalledTimes(1)
		await expect(salts.forHit({ scope: 'never', at, zone: failing })).rejects.toBeInstanceOf(
			TimezoneResolutionError
		)
	})

	it('forgets the oldest recorded fallback zones past the scopes it remembers', async () => {
		const recorded = vi.fn(async () => 'Asia/Kolkata')
		const salts = createDailySalts({ state: fakeState().state, recorded })
		const at = new Date('2026-10-05T20:00:00.000Z')
		const failing = () => Promise.reject(new Error('tenant lookup down'))
		for (let i = 0; i <= MAX_REMEMBERED_SCOPES; i++) {
			await salts.forHit({ scope: `s${i}`, at, zone: failing })
		}
		await salts.forHit({ scope: 's0', at, zone: failing })
		expect(recorded).toHaveBeenCalledTimes(MAX_REMEMBERED_SCOPES + 2)
	})

	it('deletes the expired salts once for each later day it fetches', async () => {
		const { state, sweeps } = fakeState()
		const at = new Date('2026-10-05T20:00:00.000Z')
		const salts = createDailySalts({ state, now: () => at })
		await salts.forDay(20261005)
		await salts.forDay(20261005)
		expect(sweeps).toEqual([at])
		await salts.forDay(20261006)
		await salts.forDay(20261004)
		expect(sweeps).toEqual([at, at])
	})

	it('serves the salt and only warns when deleting the expired ones fails', async () => {
		const warn = vi.fn()
		const salts = createDailySalts({ state: fakeState(undefined, true).state, warn })
		await expect(salts.forDay(20261005)).resolves.toBe('salt-20261005')
		await settle()
		expect(warn).toHaveBeenCalledTimes(1)
		expect(String(warn.mock.calls[0]?.[0])).toContain(
			'deleting expired visitor salts failed: Error: state store down'
		)
	})

	it('keeps each instance’s days apart: nothing is cached at module level', async () => {
		const first = fakeState()
		const second = fakeState()
		await createDailySalts({ state: first.state }).forDay(20261005)
		await createDailySalts({ state: second.state }).forDay(20261005)
		expect(first.asked).toContain(20261005)
		expect(second.asked).toContain(20261005)
	})
})

describe('saltForHit', () => {
	const at = new Date('2026-10-05T20:00:00.000Z')

	it("answers the salt of the hit's local day while its zone resolves", async () => {
		const salts = createDailySalts({ state: fakeState().state })
		const unresolved = vi.fn()
		const salt = await saltForHit(
			salts,
			{ scope: 'in', at, zone: () => 'Asia/Kolkata' },
			unresolved
		)
		expect(salt).toBe('salt-20261006')
		expect(unresolved).not.toHaveBeenCalled()
	})

	it('answers the salt of the UTC day for a scope with no good zone yet, and says so', async () => {
		const salts = createDailySalts({ state: fakeState().state })
		const unresolved = vi.fn()
		const salt = await saltForHit(
			salts,
			{ scope: 'in', at, zone: () => Promise.reject(new Error('tenant lookup down')) },
			unresolved
		)
		expect(salt).toBe('salt-20261005')
		expect(unresolved).toHaveBeenCalledTimes(1)
		expect(unresolved.mock.calls[0]?.[0]).toBeInstanceOf(TimezoneResolutionError)
	})

	it('lets a failure of the salt store itself through', async () => {
		const salts = createDailySalts({ state: fakeState(() => true).state })
		await expect(
			saltForHit(salts, { scope: 'in', at, zone: () => 'UTC' }, vi.fn())
		).rejects.toThrow('no salt for 20261005')
	})
})
