import { describe, expect, it } from 'vitest'
import { clampDayRange, dayRangeCaption, dayRangeDays } from './dayRange'

describe('dayRangeDays', () => {
	it('counts both ends of the window', () => {
		expect(dayRangeDays({ from: '2026-06-01', to: '2026-06-01' })).toBe(1)
		expect(dayRangeDays({ from: '2026-06-01', to: '2026-06-30' })).toBe(30)
	})

	it('counts a window spanning a DST change by calendar days, not hours', () => {
		expect(dayRangeDays({ from: '2026-03-28', to: '2026-03-30' })).toBe(3)
	})

	it('reports a single day for an unreadable or inverted window', () => {
		expect(dayRangeDays({ from: 'nonsense', to: '2026-06-30' })).toBe(1)
		expect(dayRangeDays({ from: '2026-06-30', to: '2026-06-01' })).toBe(1)
	})
})

describe('clampDayRange', () => {
	it('leaves a window the source can serve alone', () => {
		const range = { from: '2026-06-01', to: '2026-06-10' }
		expect(clampDayRange(range, 'from', 90)).toEqual(range)
		expect(clampDayRange(range, 'to', null)).toEqual(range)
	})

	it('moves the other bound when the edited one makes the window too long', () => {
		expect(clampDayRange({ from: '2026-01-01', to: '2026-12-31' }, 'from', 90)).toEqual({
			from: '2026-01-01',
			to: '2026-03-31',
		})
		expect(clampDayRange({ from: '2026-01-01', to: '2026-12-31' }, 'to', 90)).toEqual({
			from: '2026-10-03',
			to: '2026-12-31',
		})
	})

	it('collapses an inverted window onto the edited bound', () => {
		expect(clampDayRange({ from: '2026-06-10', to: '2026-06-01' }, 'from', null)).toEqual({
			from: '2026-06-10',
			to: '2026-06-10',
		})
		expect(clampDayRange({ from: '2026-06-10', to: '2026-06-01' }, 'to', null)).toEqual({
			from: '2026-06-01',
			to: '2026-06-01',
		})
	})

	it('never exceeds the endpoint cap, whatever the source allows', () => {
		const clamped = clampDayRange({ from: '2020-01-01', to: '2026-12-31' }, 'to', null)
		expect(dayRangeDays(clamped)).toBe(366)
	})
})

describe('dayRangeCaption', () => {
	it('names the picked days in the reporting timezone', () => {
		expect(dayRangeCaption({ from: '2026-06-01', to: '2026-06-23' }, 'en', 'Europe/Berlin')).toBe(
			'Jun 1, 2026 - Jun 23, 2026'
		)
		expect(dayRangeCaption({ from: '2026-06-01', to: '2026-06-23' }, 'en', 'UTC')).toBe(
			'Jun 1, 2026 - Jun 23, 2026'
		)
	})

	it('falls back to the raw days when a bound names no calendar day', () => {
		expect(dayRangeCaption({ from: '2026-02-30', to: '2026-06-23' }, 'en', 'UTC')).toBe(
			'2026-02-30 - 2026-06-23'
		)
	})
})
