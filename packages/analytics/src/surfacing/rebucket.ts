import type {
	AnalyticsCapabilities,
	AnalyticsQuery,
	AnalyticsResult,
	AnalyticsRow,
	MetricKey,
	MetricValue,
	MetricValues,
} from '../core/contract'
import { supportsGranularity } from '../core/granularity'
import { isAverageMetric } from '../core/metricValues'
import { bucketInstant, bucketStartOf, type CalendarUnit } from '../native/engine/buckets'
import { type CalendarDay, calendarDayOf, parseCalendarDay } from '../timeframe/calendar'
import { DAY_MS, DEFAULT_TIMEZONE } from '../timeframe/tz'

/**
 * The count an average is taken over, for a row that does not say (`AnalyticsRow.samples`):
 * time and scroll per pageview, a bounce rate and a visit's length per visit.
 */
const WEIGHTS: Partial<Record<MetricKey, readonly MetricKey[]>> = {
	avgDuration: ['pageviews'],
	scrollDepth: ['pageviews'],
	bounceRate: ['visits', 'sessions'],
	visitDuration: ['visits', 'sessions'],
}

/** How the engine reads a week or month series from a source that buckets no coarser than days. */
export interface RebucketPlan {
	unit: CalendarUnit
	/** Counts the read adds only to weigh its averages, and strips from the answer again. */
	weights: MetricKey[]
}

/**
 * The plan for `q`, or undefined when it needs none: a series of weeks or months from a source
 * that does not answer those itself but serves days.
 */
export const rebucketPlan = (
	q: AnalyticsQuery,
	caps: AnalyticsCapabilities
): RebucketPlan | undefined => {
	const unit = q.granularity
	if ((unit !== 'week' && unit !== 'month') || caps.calendarBuckets === true) {
		return undefined
	}
	if (!supportsGranularity(caps, 'day')) {
		return undefined
	}
	const asked = new Set(q.metrics)
	const weights = new Set<MetricKey>()
	for (const metric of q.metrics) {
		const candidates = WEIGHTS[metric] ?? []
		if (candidates.some((candidate) => asked.has(candidate))) {
			continue
		}
		const weight = candidates.find((candidate) => caps.metrics.has(candidate))
		if (weight !== undefined) {
			weights.add(weight)
		}
	}
	return { unit, weights: [...weights] }
}

/** The read the adapter is given for a plan: days, with the weights beside the asked metrics. */
export const dayRead = (q: AnalyticsQuery, plan: RebucketPlan): AnalyticsQuery => ({
	...q,
	granularity: 'day',
	metrics: [...q.metrics, ...plan.weights],
})

/**
 * The local date a day row names: a vendor's UTC midnight labels that date, any other instant
 * starts a day in the read's zone; a zone whose days start at UTC midnight is UTC, so both agree.
 */
export const dayOfTimestamp = (timestamp: string, tz: string): CalendarDay | null => {
	const bare = parseCalendarDay(timestamp)
	if (bare !== null) {
		return bare
	}
	const at = new Date(timestamp)
	if (Number.isNaN(at.getTime())) {
		return null
	}
	return at.getTime() % DAY_MS === 0 ? calendarDayOf(at, 'UTC') : calendarDayOf(at, tz)
}

const nonNegative = (value: unknown): number | undefined =>
	typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined

/** What one row's reading of an average counts for: its own samples, else its matching count. */
const weightOf = (row: AnalyticsRow, metric: MetricKey): number | undefined => {
	const own = nonNegative(row.samples?.[metric])
	if (own !== undefined) {
		return own
	}
	for (const candidate of WEIGHTS[metric] ?? []) {
		const count = nonNegative(row.metrics[candidate])
		if (count !== undefined) {
			return count
		}
	}
	return undefined
}

interface Folded {
	value: MetricValue
	samples?: number
}

/**
 * One average over several rows: weighted when every reading has a weight, so a week is the
 * mean of its visits rather than of its days; a plain mean otherwise, and `null` with no reading.
 */
const foldAverage = (rows: readonly AnalyticsRow[], metric: MetricKey): Folded => {
	const readings: Array<{ value: number; weight: number | undefined }> = []
	for (const row of rows) {
		const value = row.metrics[metric]
		if (typeof value === 'number' && Number.isFinite(value)) {
			readings.push({ value, weight: weightOf(row, metric) })
		}
	}
	if (readings.length === 0) {
		return { value: null }
	}
	if (readings.some((reading) => reading.weight === undefined)) {
		const sum = readings.reduce((total, reading) => total + reading.value, 0)
		return { value: Math.round(sum / readings.length) }
	}
	let weights = 0
	let sum = 0
	for (const { value, weight = 0 } of readings) {
		weights += weight
		sum += value * weight
	}
	return weights > 0
		? { value: Math.round(sum / weights), samples: weights }
		: { value: null, samples: 0 }
}

const foldCount = (rows: readonly AnalyticsRow[], metric: MetricKey): number =>
	rows.reduce((sum, row) => {
		const value = row.metrics[metric]
		return typeof value === 'number' && Number.isFinite(value) ? sum + value : sum
	}, 0)

/** `metrics` narrowed to the ones the read asked for, which drops the weights a plan added. */
const askedOnly = (metrics: MetricValues, asked: readonly MetricKey[]): MetricValues => {
	const out: MetricValues = {}
	for (const metric of asked) {
		const value = metrics[metric]
		if (value !== undefined) {
			out[metric] = value
		}
	}
	return out
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

const dimensionKey = (dimensions: AnalyticsRow['dimensions']): string =>
	JSON.stringify(
		Object.entries(dimensions ?? {})
			.filter(([, value]) => value !== undefined)
			.sort(([a], [b]) => compareText(a, b))
	)

interface Bucket {
	key: string
	dimensions: AnalyticsRow['dimensions']
	start: CalendarDay
	rows: AnalyticsRow[]
	/** The days whose rows counted visitors. */
	visitorDays: Set<CalendarDay>
}

const foldBucket = (bucket: Bucket, tz: string, asked: readonly MetricKey[]): AnalyticsRow => {
	const metrics: MetricValues = {}
	const samples: Partial<Record<MetricKey, number>> = {}
	for (const metric of asked) {
		if (!bucket.rows.some((row) => row.metrics[metric] !== undefined)) {
			continue
		}
		if (!isAverageMetric(metric)) {
			metrics[metric] = foldCount(bucket.rows, metric)
			continue
		}
		const folded = foldAverage(bucket.rows, metric)
		metrics[metric] = folded.value
		if (folded.samples !== undefined) {
			samples[metric] = folded.samples
		}
	}
	return {
		...(bucket.dimensions === undefined ? {} : { dimensions: bucket.dimensions }),
		timestamp: bucketInstant(bucket.start, tz).toISOString(),
		metrics,
		...(Object.keys(samples).length > 0 ? { samples } : {}),
	}
}

/**
 * A day series folded into the asked weeks or months in the reporting zone: counts add, averages
 * are weighted, visitors add per day (so a multi-day bucket marks the read `sumOfDaily`).
 */
export const foldResult = (
	result: AnalyticsResult,
	q: AnalyticsQuery,
	plan: RebucketPlan
): AnalyticsResult => {
	const tz = q.timezone ?? DEFAULT_TIMEZONE
	const passthrough: AnalyticsRow[] = []
	const buckets = new Map<string, Bucket>()
	for (const row of result.rows) {
		if (row.timestamp === undefined) {
			passthrough.push(
				plan.weights.length === 0 ? row : { ...row, metrics: askedOnly(row.metrics, q.metrics) }
			)
			continue
		}
		const day = dayOfTimestamp(row.timestamp, tz)
		if (day === null) {
			continue
		}
		const start = bucketStartOf(day, plan.unit)
		const key = `${dimensionKey(row.dimensions)}|${start}`
		const bucket = buckets.get(key) ?? {
			key,
			dimensions: row.dimensions,
			start,
			rows: [],
			visitorDays: new Set<CalendarDay>(),
		}
		bucket.rows.push(row)
		if (typeof row.metrics.visitors === 'number') {
			bucket.visitorDays.add(day)
		}
		buckets.set(key, bucket)
	}
	const ordered = [...buckets.values()].sort((a, b) => compareText(a.key, b.key))
	const summed =
		q.metrics.includes('visitors') && ordered.some((bucket) => bucket.visitorDays.size > 1)
	const meta: AnalyticsResult['meta'] = summed
		? { ...result.meta, visitorsAre: 'sumOfDaily' }
		: result.meta
	return {
		...result,
		rows: [...passthrough, ...ordered.map((bucket) => foldBucket(bucket, tz, q.metrics))],
		...(result.totals === undefined || plan.weights.length === 0
			? {}
			: { totals: askedOnly(result.totals, q.metrics) }),
		meta,
	}
}
