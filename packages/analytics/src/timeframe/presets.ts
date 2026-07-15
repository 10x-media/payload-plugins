import type { DateRange } from '../core/contract'
import {
	addDaysInTz,
	DEFAULT_TIMEZONE,
	startOfDayInTz,
	startOfMonthInTz,
	startOfYearInTz,
} from './tz'

export const TIMEFRAME_PRESETS = [
	'today',
	'last7days',
	'last30days',
	'last90days',
	'thisMonth',
	'thisYear',
	'lastYear',
	'allTime',
] as const

export type TimeframePreset = (typeof TIMEFRAME_PRESETS)[number]

/**
 * Resolve a relative timeframe preset to an absolute `DateRange`. `now` is injected
 * so callers stay deterministic. `end` is `now`; `start` is the day floor of the
 * window in `tz` (defaulting to UTC, so day boundaries align with the reporting
 * timezone). Inclusive day windows count the current day (`last7days` = today plus 6).
 */
export const resolveTimeframe = (
	preset: TimeframePreset,
	now: Date,
	tz: string = DEFAULT_TIMEZONE
): DateRange => {
	const end = new Date(now)
	switch (preset) {
		case 'today':
			return { start: startOfDayInTz(now, tz), end }
		case 'last7days':
			return { start: addDaysInTz(now, -6, tz), end }
		case 'last30days':
			return { start: addDaysInTz(now, -29, tz), end }
		case 'last90days':
			return { start: addDaysInTz(now, -89, tz), end }
		case 'thisMonth':
			return { start: startOfMonthInTz(now, tz), end }
		case 'thisYear':
			return { start: startOfYearInTz(now, tz), end }
		case 'lastYear':
			return { start: addDaysInTz(now, -364, tz), end }
		case 'allTime':
			return { start: new Date(0), end }
	}
}
