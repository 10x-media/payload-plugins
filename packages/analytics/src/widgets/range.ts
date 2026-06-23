import type { DateRange } from '../core/contract'
import type { WidgetRange } from './types'

/**
 * Resolve a widget's explicit custom range to a concrete DateRange, or undefined when
 * the widget is on a relative preset, the custom range is incomplete, or either bound
 * is an unparseable date (a corrupt or hand-set widgetData would otherwise reach the
 * cache key and throw on `toISOString`).
 */
export const resolveCustomRange = (
	timeframe: string | undefined,
	range: WidgetRange | undefined
): DateRange | undefined => {
	if (timeframe !== 'custom' || !range?.from || !range?.to) {
		return undefined
	}
	const start = new Date(range.from)
	const end = new Date(range.to)
	if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
		return undefined
	}
	return { start, end }
}

const formatDay = (d: Date, locale: string): string =>
	d.toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' })

/** Server-side caption for a custom range, e.g. "Jun 1, 2026 - Jun 23, 2026". */
export const formatRangeCaption = (range: DateRange, locale: string): string =>
	`${formatDay(range.start, locale)} - ${formatDay(range.end, locale)}`
