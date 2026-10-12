import { describe, expect, it } from 'vitest'
import { pickedDay } from '../widgets/range'
import { calendarDay, pickerDate, shownBound, storedBound } from './calendarDays'

describe('picker days', () => {
	it('reads a calendar day as local midnight and writes it back unchanged', () => {
		const date = pickerDate('2026-10-05')
		expect(date?.getHours()).toBe(0)
		expect(date ? calendarDay(date) : null).toBe('2026-10-05')
	})

	it('reads no date from anything but a real calendar day', () => {
		expect(pickerDate('2026-02-30')).toBeNull()
		expect(pickerDate('05.10.2026')).toBeNull()
		expect(pickerDate('')).toBeNull()
		expect(pickerDate(undefined)).toBeNull()
	})

	it('stores a picked day at its UTC midnight', () => {
		expect(storedBound(new Date(2026, 9, 5))).toBe('2026-10-05T00:00:00.000Z')
		expect(storedBound(null)).toBeNull()
	})

	// The widget reads the bound back with `pickedDay`; the picker must show what it will read.
	it('shows a stored bound as the day the widget reads it as', () => {
		const stored = storedBound(new Date(2026, 9, 5))
		expect(stored ? pickedDay(stored) : null).toBe('2026-10-05')
		const shown = shownBound(stored)
		expect(shown ? calendarDay(shown) : null).toBe('2026-10-05')
	})

	it('shows a bound stored at a browser midnight east or west of UTC as that day', () => {
		// Midnight on 5 October in Berlin (UTC+2) and in New York (UTC-4).
		for (const stored of ['2026-10-04T22:00:00.000Z', '2026-10-05T04:00:00.000Z']) {
			const shown = shownBound(stored)
			expect(shown ? calendarDay(shown) : null).toBe('2026-10-05')
		}
	})

	it('shows nothing for a missing or unreadable bound', () => {
		expect(shownBound(null)).toBeNull()
		expect(shownBound('not a date')).toBeNull()
	})
})
