import type { DateRange } from '../core/contract'
import { isOneOf } from '../core/values'
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

export const isTimeframePreset = (value: unknown): value is TimeframePreset =>
	isOneOf(TIMEFRAME_PRESETS, value)

/**
 * `end` is `now`; `start` is the window's day floor in `tz`. Day windows include today (`last7days`
 * is today plus 6).
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
