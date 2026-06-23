import type { DateRange } from '../core/contract'
import type { WidgetRange } from './types'

/**
 * Resolve a widget's explicit custom range to a concrete DateRange, or undefined when
 * the widget is on a relative preset (or the custom range is incomplete).
 */
export const resolveCustomRange = (
	timeframe: string | undefined,
	range: WidgetRange | undefined
): DateRange | undefined => {
	if (timeframe !== 'custom' || !range?.from || !range?.to) {
		return undefined
	}
	return { start: new Date(range.from), end: new Date(range.to) }
}

const formatDay = (d: Date, locale: string): string =>
	d.toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' })

/** Server-side caption for a custom range, e.g. "Jun 1, 2026 - Jun 23, 2026". */
export const formatRangeCaption = (range: DateRange, locale: string): string =>
	`${formatDay(range.start, locale)} - ${formatDay(range.end, locale)}`
