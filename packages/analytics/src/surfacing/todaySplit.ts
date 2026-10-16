import type {
	AnalyticsFilter,
	AnalyticsQuery,
	AnalyticsResult,
	AnalyticsRow,
	MetricKey,
	MetricValues,
} from '../core/contract'
import { earlierInstant } from '../core/values'

/**
 * Event counts, which add back up exactly across any cut in time; visitors, visits and averages
 * do not, as a source counts their days in the scope's zone, not at the read's midnight.
 */
const EVENT_COUNTS: ReadonlySet<MetricKey> = new Set<MetricKey>([
	'pageviews',
	'events',
	'conversions',
	'revenue',
	'impressions',
	'interactions',
])

export interface TodaySplit {
	/** The window's whole days before today, which no longer change once counted. */
	closed: AnalyticsQuery
	today: AnalyticsQuery
}

/**
 * A read reaching from a closed day into today, cut at today's start: only totals or a day series
 * of event counts, with no breakdown, whose two halves add back up to exactly the whole.
 */
export const splitAtToday = (q: AnalyticsQuery, todayStart: number): TodaySplit | undefined => {
	const { start, end } = q.dateRange
	if (start.getTime() >= todayStart || end.getTime() < todayStart) {
		return undefined
	}
	if ((q.dimensions?.length ?? 0) > 0 || (q.granularity !== undefined && q.granularity !== 'day')) {
		return undefined
	}
	if (q.metrics.length === 0 || !q.metrics.every((metric) => EVENT_COUNTS.has(metric))) {
		return undefined
	}
	return {
		closed: { ...q, dateRange: { start, end: new Date(todayStart - 1) } },
		today: { ...q, dateRange: { start: new Date(todayStart), end } },
	}
}

const sumMetrics = (
	parts: ReadonlyArray<MetricValues | undefined>,
	metrics: readonly MetricKey[]
): MetricValues => {
	const out: MetricValues = {}
	for (const metric of metrics) {
		let seen = false
		let sum = 0
		for (const part of parts) {
			const value = part?.[metric]
			if (typeof value === 'number' && Number.isFinite(value)) {
				seen = true
				sum += value
			}
		}
		if (seen) {
			out[metric] = sum
		}
	}
	return out
}

const byTimestamp = (a: AnalyticsRow, b: AnalyticsRow): number =>
	Date.parse(a.timestamp ?? '') - Date.parse(b.timestamp ?? '')

const totalDays = (a: { days: number } | undefined, b: { days: number } | undefined): number =>
	(a?.days ?? 0) + (b?.days ?? 0)

const totalPageviews = (
	a: { pageviews: number } | undefined,
	b: { pageviews: number } | undefined
): number => (a?.pageviews ?? 0) + (b?.pageviews ?? 0)

const filtersOf = (a?: AnalyticsFilter[], b?: AnalyticsFilter[]): AnalyticsFilter[] => {
	const seen = new Map<string, AnalyticsFilter>()
	for (const filter of [...(a ?? []), ...(b ?? [])]) {
		seen.set(JSON.stringify([filter.dimension, filter.operator, filter.value]), filter)
	}
	return [...seen.values()]
}

/** The answer for the whole window out of its two halves: counts add up, caveats carry over. */
export const mergeAtToday = (
	closed: AnalyticsResult,
	today: AnalyticsResult,
	q: AnalyticsQuery
): AnalyticsResult => {
	const series = [...closed.rows, ...today.rows]
		.filter((row) => row.timestamp !== undefined)
		.sort(byTimestamp)
	const flat = [...closed.rows, ...today.rows].filter((row) => row.timestamp === undefined)
	const rows =
		flat.length === 0
			? series
			: [
					{
						metrics: sumMetrics(
							flat.map((row) => row.metrics),
							q.metrics
						),
					},
					...series,
				]
	const totals =
		closed.totals === undefined && today.totals === undefined
			? undefined
			: sumMetrics([closed.totals, today.totals], q.metrics)
	const a = closed.meta
	const b = today.meta
	const partial = (a.partial?.missingDays ?? 0) + (b.partial?.missingDays ?? 0)
	const capped = totalDays(a.capped, b.capped)
	const failed = totalDays(a.failed, b.failed)
	const withoutConsent = totalPageviews(a.withoutConsent, b.withoutConsent)
	const withoutVisitor = totalPageviews(a.withoutVisitor, b.withoutVisitor)
	const currencies = new Set([...(a.mixedCurrencies ?? []), ...(b.mixedCurrencies ?? [])])
	const unapplied = filtersOf(a.unappliedFilters, b.unappliedFilters)
	const fetchedAt = earlierInstant(a.fetchedAt, b.fetchedAt)
	const asOf = earlierInstant(a.asOf, b.asOf)
	const dataTo = earlierInstant(a.dataTo, b.dataTo)
	const sourceError = a.sourceError ?? b.sourceError
	const currency = a.currency ?? b.currency
	return {
		rows,
		...(totals ? { totals } : {}),
		meta: {
			provider: a.provider,
			fetchedAt,
			...(asOf ? { asOf } : {}),
			...(a.clamped || b.clamped ? { clamped: true } : {}),
			...(a.dataFrom ? { dataFrom: a.dataFrom } : {}),
			...(dataTo ? { dataTo } : {}),
			...(a.sampled || b.sampled ? { sampled: true } : {}),
			...(partial > 0 ? { partial: { missingDays: partial } } : {}),
			...(capped > 0 ? { capped: { days: capped } } : {}),
			...(failed > 0 ? { failed: { days: failed } } : {}),
			...(a.timezoneUnresolved || b.timezoneUnresolved ? { timezoneUnresolved: true } : {}),
			...(currency ? { currency } : {}),
			...(currencies.size > 1 ? { mixedCurrencies: [...currencies].sort() } : {}),
			...(a.stale || b.stale ? { stale: true } : {}),
			...(sourceError ? { sourceError } : {}),
			...(unapplied.length > 0 ? { unappliedFilters: unapplied } : {}),
			...(a.goalsUnresolved || b.goalsUnresolved ? { goalsUnresolved: true } : {}),
			...(withoutConsent > 0 ? { withoutConsent: { pageviews: withoutConsent } } : {}),
			...(withoutVisitor > 0 ? { withoutVisitor: { pageviews: withoutVisitor } } : {}),
			...(a.withoutConsentDropped || b.withoutConsentDropped
				? { withoutConsentDropped: true }
				: {}),
		},
	}
}
