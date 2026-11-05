import type { AnalyticsRow, MetricKey, MetricValue, MetricValues } from './contract'

/**
 * Metrics that are an average or a share rather than a count. Each reads `null` when it has
 * nothing to average over, and none of them adds up: a week of daily averages is not their sum.
 */
const AVERAGE_METRICS: ReadonlySet<MetricKey> = new Set<MetricKey>([
	'avgDuration',
	'visitDuration',
	'scrollDepth',
	'bounceRate',
])

export const isAverageMetric = (metric: MetricKey): boolean => AVERAGE_METRICS.has(metric)

/** What a metric with no reading shows: a dash, never a zero that reads as a measurement. */
export const NO_VALUE = '-'

/**
 * The reading a series point takes when its bucket has no row at all: zero for a count, since
 * no events is a real zero, and `null` for an average, which has nothing to average over.
 */
export const emptyReading = (metric: MetricKey): MetricValue => (isAverageMetric(metric) ? null : 0)

/**
 * A vendor's raw value for one metric: a finite number or numeric string is kept; anything else is
 * no data, `null` for an average (a 0 would read as measured) and 0 for a count.
 */
export const vendorReading = (metric: MetricKey, raw: unknown): MetricValue => {
	const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value
	}
	return emptyReading(metric)
}

/** One metric out of a read's metrics, an unreported one taken as its {@link emptyReading}. */
export const readingOf = (metrics: MetricValues | undefined, metric: MetricKey): MetricValue =>
	metrics?.[metric] ?? emptyReading(metric)

/**
 * Folds several readings of one metric into one: counts add up, and an average is the mean of
 * the readings that have data, or `null` when none has.
 */
export const combineMetricValues = (metric: MetricKey, values: MetricValue[]): MetricValue => {
	const present = values.filter((value): value is number => typeof value === 'number')
	if (!isAverageMetric(metric)) {
		return present.reduce((sum, value) => sum + value, 0)
	}
	if (present.length === 0) {
		return null
	}
	return Math.round(present.reduce((sum, value) => sum + value, 0) / present.length)
}

/**
 * Rows ranked by one metric. A row with no reading for it sorts last whichever way the list
 * runs: "no data" is neither the biggest number nor the smallest.
 */
export const sortRowsByMetric = (
	rows: AnalyticsRow[],
	metric: MetricKey,
	direction: 'asc' | 'desc'
): AnalyticsRow[] => {
	const sign = direction === 'asc' ? 1 : -1
	return [...rows].sort((a, b) => {
		const left = a.metrics[metric]
		const right = b.metrics[metric]
		const leftMissing = typeof left !== 'number'
		const rightMissing = typeof right !== 'number'
		if (leftMissing || rightMissing) {
			return leftMissing === rightMissing ? 0 : leftMissing ? 1 : -1
		}
		return (left - right) * sign
	})
}
