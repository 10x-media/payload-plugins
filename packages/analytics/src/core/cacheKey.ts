import type { AnalyticsQuery } from './contract'

const stable = (xs?: string[]): string => (xs ? [...xs].sort().join(',') : '')

export function buildCacheKey(provider: string, q: AnalyticsQuery): string {
	const scope = q.path ?? 'site'
	const range = `${q.dateRange.start.toISOString()}_${q.dateRange.end.toISOString()}`
	const filters = (q.filters ?? [])
		.map((f) => `${f.dimension}${f.operator}${f.value}`)
		.sort()
		.join(';')
	return [
		'analytics',
		provider,
		q.hostname ?? '_',
		scope,
		stable(q.metrics),
		stable(q.dimensions),
		range,
		q.granularity ?? '_',
		filters,
		String(q.limit ?? '_'),
		q.order ? `${q.order.metric}:${q.order.direction}` : '_',
	].join('|')
}
