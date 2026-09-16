import { addDaysInTz, DEFAULT_TIMEZONE, startOfDayInTz } from '../timeframe/tz'
import type { AnalyticsQuery } from './contract'

const stable = (xs?: string[]): string => (xs ? [...xs].sort().join(',') : '')

/**
 * The window segment. A live window (a preset ends at `now`) snaps to whole days, so every
 * render within one day shares one entry. A closed window, whose end is the final instant
 * of its day in `tz`, keys on its exact bounds instead: snapping those too would let two
 * windows that differ only inside their last day share an entry, and an instant-comparing
 * adapter read the narrower one's answer.
 */
const rangeKey = (range: AnalyticsQuery['dateRange'], tz: string): string => {
	const nextDay = addDaysInTz(range.end, 1, tz)
	if (nextDay.getTime() - 1 === range.end.getTime()) {
		return `${range.start.toISOString()}_${range.end.toISOString()}`
	}
	return `${startOfDayInTz(range.start, tz).toISOString()}_${nextDay.toISOString()}`
}

export function buildCacheKey(provider: string, q: AnalyticsQuery): string {
	const pathKey = q.path ?? 'site'
	const tz = q.timezone ?? DEFAULT_TIMEZONE
	const range = rangeKey(q.dateRange, tz)
	const filters = (q.filters ?? [])
		.map((f) => `${f.dimension}${f.operator}${f.value}`)
		.sort()
		.join(';')
	return [
		'analytics',
		provider,
		q.hostname ?? '_',
		pathKey,
		stable(q.metrics),
		stable(q.dimensions),
		range,
		q.granularity ?? '_',
		filters,
		String(q.limit ?? '_'),
		q.order ? `${q.order.metric}:${q.order.direction}` : '_',
		// Appended only for a non-UTC timezone so default (UTC) keys keep their format.
		...(q.timezone !== undefined && q.timezone !== DEFAULT_TIMEZONE ? [q.timezone] : []),
		...(q.scope !== undefined ? [encodeURIComponent(q.scope)] : []),
		// A provider read restricts its goal rows to the hint, so two hints answer differently
		// and must never share an entry. Prefixed, so the segment cannot read as a scope.
		...(q.goalSlugs?.length ? [`goals:${stable(q.goalSlugs)}`] : []),
	].join('|')
}
