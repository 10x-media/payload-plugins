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

/**
 * The goal segment, absent for a read with no hint and for an install with no goals, which
 * both ask the provider for the same rows. The failed-resolver segment carries a `!`, which
 * `GOAL_SLUG_PATTERN` forbids, so no list of slugs can be written to look like it.
 */
const goalKey = (goalSlugs: AnalyticsQuery['goalSlugs']): string[] => {
	if (goalSlugs === 'unresolved') {
		return ['goals:!unresolved']
	}
	return goalSlugs?.length ? [`goals:${stable(goalSlugs)}`] : []
}

export interface CacheKeyOptions {
	/** The scope's cache epoch; raising it retires every entry keyed on the old one. */
	epoch?: number
}

export function buildCacheKey(
	provider: string,
	q: AnalyticsQuery,
	opts: CacheKeyOptions = {}
): string {
	const pathKey = q.path ?? 'site'
	const tz = q.timezone ?? DEFAULT_TIMEZONE
	const range = rangeKey(q.dateRange, tz)
	const filters = (q.filters ?? [])
		.map((f) => `${f.dimension}${f.operator}${f.value}`)
		.sort()
		.join(';')
	return [
		'analytics',
		// Fixed second segment, always written, so there is one key format rather than two;
		// its position keeps an adapter id spelled like an epoch from ever colliding with one.
		`e${opts.epoch ?? 0}`,
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
		// and must never share an entry. A failed resolver keys on its own segment rather than
		// on the healthy no-hint key. Prefixed, so the segment cannot read as a scope.
		...goalKey(q.goalSlugs),
	].join('|')
}
