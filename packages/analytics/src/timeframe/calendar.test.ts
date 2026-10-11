import { describe, expect, it } from 'vitest'
import {
	addCalendarDays,
	calendarDate,
	calendarDayOf,
	calendarDayStart,
	calendarDaysBetween,
	formatCalendarDay,
	isCalendarDay,
	monthStartOf,
	nextMonthStart,
	parseCalendarDay,
	toCalendarDay,
	weekStartOf,
} from './calendar'

describe('calendar days', () => {
	it('round-trips a date through its number', () => {
		expect(toCalendarDay({ year: 2026, month: 10, day: 5 })).toBe(20261005)
		expect(calendarDate(20261005)).toEqual({ year: 2026, month: 10, day: 5 })
	})

	it('knows a real date from one that does not exist', () => {
		expect(isCalendarDay(20280229)).toBe(true)
		expect(isCalendarDay(20260229)).toBe(false)
		expect(isCalendarDay(20261301)).toBe(false)
		expect(isCalendarDay(20261000)).toBe(false)
		expect(isCalendarDay(2026100.5)).toBe(false)
	})

	it('reads and writes the YYYY-MM-DD form, refusing anything else', () => {
		expect(parseCalendarDay('2026-03-08')).toBe(20260308)
		expect(formatCalendarDay(20260308)).toBe('2026-03-08')
		expect(parseCalendarDay('2026-02-30')).toBeNull()
		expect(parseCalendarDay('2026-3-8')).toBeNull()
		expect(parseCalendarDay('2026-03-08T00:00:00.000Z')).toBeNull()
	})

	it('names the local date of an instant in its zone', () => {
		const berlinMidnight = new Date('2026-08-31T22:00:00.000Z')
		expect(calendarDayOf(berlinMidnight, 'Europe/Berlin')).toBe(20260901)
		expect(calendarDayOf(berlinMidnight, 'UTC')).toBe(20260831)
		expect(calendarDayOf(new Date('2026-09-08T03:59:59.999Z'), 'America/New_York')).toBe(20260907)
	})

	it('steps whole days across months, years and leap days', () => {
		expect(addCalendarDays(20261231, 1)).toBe(20270101)
		expect(addCalendarDays(20280228, 1)).toBe(20280229)
		expect(addCalendarDays(20260301, -1)).toBe(20260228)
		expect(calendarDaysBetween(20260101, 20261231)).toBe(364)
		expect(calendarDaysBetween(20261231, 20260101)).toBe(-364)
	})

	it('starts a week on its Monday, a Sunday closing the week before', () => {
		expect(weekStartOf(20260302)).toBe(20260302)
		expect(weekStartOf(20260308)).toBe(20260302)
		expect(weekStartOf(20260309)).toBe(20260309)
		expect(weekStartOf(20270101)).toBe(20261228)
	})

	it('starts a month on its first, the next one after December in January', () => {
		expect(monthStartOf(20260317)).toBe(20260301)
		expect(nextMonthStart(20260317)).toBe(20260401)
		expect(nextMonthStart(20261201)).toBe(20270101)
	})

	it('turns a date into the instant it starts, which is not always midnight', () => {
		expect(calendarDayStart(20260308, 'America/New_York').toISOString()).toBe(
			'2026-03-08T05:00:00.000Z'
		)
		expect(calendarDayStart(20260309, 'America/New_York').toISOString()).toBe(
			'2026-03-09T04:00:00.000Z'
		)
		// Chile springs forward at midnight: the 6th of September 2026 starts at local 01:00.
		expect(calendarDayStart(20260906, 'America/Santiago').toISOString()).toBe(
			'2026-09-06T04:00:00.000Z'
		)
	})
})
