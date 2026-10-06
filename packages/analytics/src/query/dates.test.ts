import { describe, expect, it } from 'vitest'
import { parseDayOrInstant } from './dates'

describe('parseDayOrInstant', () => {
	it('resolves a day string to the first instant of that day in the timezone', () => {
		expect(parseDayOrInstant('2026-06-23', { timezone: 'UTC', edge: 'start' })?.toISOString()).toBe(
			'2026-06-23T00:00:00.000Z'
		)
		expect(
			parseDayOrInstant('2026-06-23', { timezone: 'Europe/Berlin', edge: 'start' })?.toISOString()
		).toBe('2026-06-22T22:00:00.000Z')
		expect(
			parseDayOrInstant('2026-06-23', {
				timezone: 'America/New_York',
				edge: 'start',
			})?.toISOString()
		).toBe('2026-06-23T04:00:00.000Z')
	})

	it('resolves a day string to the last instant of that day in the timezone', () => {
		expect(parseDayOrInstant('2026-06-23', { timezone: 'UTC', edge: 'end' })?.toISOString()).toBe(
			'2026-06-23T23:59:59.999Z'
		)
		expect(
			parseDayOrInstant('2026-06-23', { timezone: 'Europe/Berlin', edge: 'end' })?.toISOString()
		).toBe('2026-06-23T21:59:59.999Z')
	})

	it('spans the 25-hour day a DST fall-back adds', () => {
		const start = parseDayOrInstant('2026-10-25', { timezone: 'Europe/Berlin', edge: 'start' })
		const end = parseDayOrInstant('2026-10-25', { timezone: 'Europe/Berlin', edge: 'end' })
		expect(end && start && end.getTime() - start.getTime() + 1).toBe(25 * 3_600_000)
	})

	it('takes an offset-bearing datetime as the instant it names', () => {
		expect(
			parseDayOrInstant('2026-06-23T10:30:00Z', { timezone: 'Europe/Berlin', edge: 'end' })
		).toEqual(new Date('2026-06-23T10:30:00Z'))
		expect(
			parseDayOrInstant('2026-06-23T10:30:00+02:00', { timezone: 'UTC', edge: 'start' })
		).toEqual(new Date('2026-06-23T08:30:00Z'))
		expect(
			parseDayOrInstant('2026-06-23T10:30:00.123456+02:00', { timezone: 'UTC', edge: 'start' })
		).toEqual(new Date('2026-06-23T08:30:00.123Z'))
	})

	it('rejects a datetime without an offset', () => {
		expect(parseDayOrInstant('2026-06-23T10:30:00', { timezone: 'UTC', edge: 'start' })).toBeNull()
		expect(parseDayOrInstant('2026-06-23 10:30:00Z', { timezone: 'UTC', edge: 'start' })).toBeNull()
	})

	it('rejects loose forms Date would otherwise accept', () => {
		for (const raw of ['2026', '2026-06', 'Jun 1 2026', 'not-a-date', '']) {
			expect(parseDayOrInstant(raw, { timezone: 'UTC', edge: 'start' })).toBeNull()
		}
	})

	it('rejects a day that names no real calendar date', () => {
		expect(parseDayOrInstant('2026-02-30', { timezone: 'UTC', edge: 'start' })).toBeNull()
		expect(parseDayOrInstant('2026-13-01', { timezone: 'UTC', edge: 'start' })).toBeNull()
		expect(parseDayOrInstant('2026-00-10', { timezone: 'UTC', edge: 'start' })).toBeNull()
		expect(parseDayOrInstant('2026-02-29T00:00:00Z', { timezone: 'UTC', edge: 'start' })).toBeNull()
	})

	it('accepts the leap day of a leap year', () => {
		expect(parseDayOrInstant('2028-02-29', { timezone: 'UTC', edge: 'start' })?.toISOString()).toBe(
			'2028-02-29T00:00:00.000Z'
		)
	})
})
