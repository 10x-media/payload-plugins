import {
	calendarDate,
	formatCalendarDay,
	parseCalendarDay,
	toCalendarDay,
} from '../timeframe/calendar'
import { pickedDay } from '../widgets/range'

/** A `YYYY-MM-DD` day as the picker's local midnight; null when it names no calendar day. */
export const pickerDate = (day: string | null | undefined): Date | null => {
	const parsed = day ? parseCalendarDay(day) : null
	if (parsed === null) {
		return null
	}
	const { year, month, day: date } = calendarDate(parsed)
	return new Date(year, month - 1, date)
}

/** The local calendar day a picker date shows, as `YYYY-MM-DD`. */
export const calendarDay = (date: Date): string =>
	formatCalendarDay(
		toCalendarDay({ year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() })
	)

/**
 * A picked day as the range field stores it, its UTC midnight; {@link pickedDay} reads it back as
 * the same day in every timezone.
 */
export const storedBound = (date: Date | null): string | null =>
	date === null
		? null
		: new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())).toISOString()

/** A stored bound as the picker shows it: the day the widgets read it as, at local midnight. */
export const shownBound = (stored: string | null | undefined): Date | null =>
	pickerDate(stored ? pickedDay(stored) : null)
