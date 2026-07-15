import { addDaysInTz, DEFAULT_TIMEZONE, startOfDayInTz } from '../timeframe/tz'
import type { AnalyticsQuery } from './contract'

const stable = (xs?: string[]): string => (xs ? [...xs].sort().join(',') : '')

export function buildCacheKey(provider: string, q: AnalyticsQuery): string {
	const pathKey = q.path ?? 'site'
	const tz = q.timezone ?? DEFAULT_TIMEZONE
	const range = `${startOfDayInTz(q.dateRange.start, tz).toISOString()}_${addDaysInTz(q.dateRange.end, 1, tz).toISOString()}`
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
	].join('|')
}
