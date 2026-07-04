import type { AnalyticsQuery } from './contract'

const stable = (xs?: string[]): string => (xs ? [...xs].sort().join(',') : '')

const startOfUtcDay = (d: Date): Date =>
	new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))

const startOfNextUtcDay = (d: Date): Date => {
	const day = startOfUtcDay(d)
	day.setUTCDate(day.getUTCDate() + 1)
	return day
}

export function buildCacheKey(provider: string, q: AnalyticsQuery): string {
	const pathKey = q.path ?? 'site'
	const range = `${startOfUtcDay(q.dateRange.start).toISOString()}_${startOfNextUtcDay(q.dateRange.end).toISOString()}`
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
		// Appended only for scoped reads so unscoped keys keep their historical format.
		...(q.scope !== undefined ? [encodeURIComponent(q.scope)] : []),
	].join('|')
}
