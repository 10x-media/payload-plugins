import { describe, expect, it } from 'vitest'
import {
	addDaysInTz,
	isValidTimeZone,
	startOfDayInTz,
	startOfMonthInTz,
	startOfYearInTz,
	zonedDayIso,
} from './tz'

describe('startOfDayInTz', () => {
	it('matches the UTC-day floor for the UTC zone', () => {
		const d = new Date('2026-06-17T14:30:12.913Z')
		expect(startOfDayInTz(d, 'UTC').toISOString()).toBe('2026-06-17T00:00:00.000Z')
	})

	it('defaults to UTC when no zone is given', () => {
		const d = new Date('2026-06-17T14:30:00.000Z')
		expect(startOfDayInTz(d).toISOString()).toBe('2026-06-17T00:00:00.000Z')
	})

	it('resolves local midnight for an east-of-UTC zone (Berlin, DST)', () => {
		// 10:00Z on 2026-07-14 is 12:00 in Berlin (UTC+2); local midnight is 22:00Z the day before.
		const d = new Date('2026-07-14T10:00:00.000Z')
		expect(startOfDayInTz(d, 'Europe/Berlin').toISOString()).toBe('2026-07-13T22:00:00.000Z')
	})

	it('steps forward when local midnight does not exist (Santiago, DST at 00:00)', () => {
		// Chile springs forward AT midnight: 2026-09-06 starts at local 01:00 -03 (04:00Z).
		const d = new Date('2026-09-06T12:00:00.000Z')
		const floored = startOfDayInTz(d, 'America/Santiago')
		expect(floored.toISOString()).toBe('2026-09-06T04:00:00.000Z')
		expect(startOfDayInTz(floored, 'America/Santiago').toISOString()).toBe(floored.toISOString())
	})

	it('steps forward when local midnight does not exist (Havana, DST at 00:00)', () => {
		// Cuba springs forward at midnight: 2026-03-08 starts at local 01:00 -04 (05:00Z).
		const d = new Date('2026-03-08T12:00:00.000Z')
		const floored = startOfDayInTz(d, 'America/Havana')
		expect(floored.toISOString()).toBe('2026-03-08T05:00:00.000Z')
		expect(startOfDayInTz(floored, 'America/Havana').toISOString()).toBe(floored.toISOString())
	})

	it('resolves local midnight for a west-of-UTC zone (New York)', () => {
		// 02:00Z on 2026-07-14 is 22:00 the previous day in New York (UTC-4); local midnight is 04:00Z.
		const d = new Date('2026-07-14T02:00:00.000Z')
		expect(startOfDayInTz(d, 'America/New_York').toISOString()).toBe('2026-07-13T04:00:00.000Z')
	})
})

describe('addDaysInTz', () => {
	it('steps whole calendar days in UTC', () => {
		const d = new Date('2026-06-17T14:30:00.000Z')
		expect(addDaysInTz(d, -6, 'UTC').toISOString()).toBe('2026-06-11T00:00:00.000Z')
		expect(addDaysInTz(d, 1, 'UTC').toISOString()).toBe('2026-06-18T00:00:00.000Z')
	})

	it('round-trips across a day whose midnight does not exist (Santiago)', () => {
		const sep5 = new Date('2026-09-05T04:00:00.000Z')
		const sep6 = addDaysInTz(sep5, 1, 'America/Santiago')
		expect(sep6.toISOString()).toBe('2026-09-06T04:00:00.000Z')
		expect(addDaysInTz(sep6, -1, 'America/Santiago').toISOString()).toBe(sep5.toISOString())
		expect(addDaysInTz(sep6, 1, 'America/Santiago').toISOString()).toBe('2026-09-07T03:00:00.000Z')
	})

	it('crosses a spring-forward DST boundary keeping local midnight (Berlin)', () => {
		// CEST begins 2026-03-29 in Berlin. Stepping from the 28th lands on local midnight the 29th.
		const d = new Date('2026-03-28T12:00:00.000Z')
		const next = addDaysInTz(d, 1, 'Europe/Berlin')
		expect(zonedDayIso(next, 'Europe/Berlin')).toBe(next.toISOString())
	})
})

describe('startOfMonthInTz / startOfYearInTz', () => {
	it('floors to the local first-of-month and Jan 1', () => {
		const d = new Date('2026-06-17T14:30:00.000Z')
		expect(startOfMonthInTz(d, 'UTC').toISOString()).toBe('2026-06-01T00:00:00.000Z')
		expect(startOfYearInTz(d, 'UTC').toISOString()).toBe('2026-01-01T00:00:00.000Z')
	})
})

describe('isValidTimeZone', () => {
	it('accepts real zones and rejects nonsense', () => {
		expect(isValidTimeZone('Europe/Berlin')).toBe(true)
		expect(isValidTimeZone('UTC')).toBe(true)
		expect(isValidTimeZone('Not/AZone')).toBe(false)
	})
})
