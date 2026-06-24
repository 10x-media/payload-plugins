import type { DateRange } from '../core/contract'

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

const startOfUtcDay = (d: Date): Date =>
	new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))

const daysBack = (d: Date, days: number): Date => {
	const start = startOfUtcDay(d)
	start.setUTCDate(start.getUTCDate() - days)
	return start
}

/**
 * Resolve a relative timeframe preset to an absolute `DateRange`. `now` is injected
 * so callers stay deterministic. `end` is `now`; `start` is the UTC-day floor of the
 * window. Inclusive day windows count the current day (`last7days` = today plus 6).
 */
export const resolveTimeframe = (preset: TimeframePreset, now: Date): DateRange => {
	const end = new Date(now)
	switch (preset) {
		case 'today':
			return { start: startOfUtcDay(now), end }
		case 'last7days':
			return { start: daysBack(now, 6), end }
		case 'last30days':
			return { start: daysBack(now, 29), end }
		case 'last90days':
			return { start: daysBack(now, 89), end }
		case 'thisMonth':
			return { start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), end }
		case 'thisYear':
			return { start: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)), end }
		case 'lastYear':
			return { start: daysBack(now, 364), end }
		case 'allTime':
			return { start: new Date(0), end }
	}
}
