import { metricReaches, supportsFilter } from '../core/capabilities'
import {
	type AnalyticsCapabilities,
	type AnalyticsFilter,
	type AnalyticsQuery,
	type DimensionKey,
	FILTER_OPERATORS,
	type FilterOperatorMap,
	type MetricKey,
} from '../core/contract'
import { zonedCalendarDay } from '../timeframe/tz'

/** The keys of `all` a vendor map names, in `all`'s order. */
export const mappedKeys = <K extends string>(
	all: readonly K[],
	map: Partial<Record<K, unknown>>
): ReadonlySet<K> => new Set(all.filter((key) => map[key] !== undefined))

/**
 * A filter map offering every contract operator on each of `dimensions` but `goal`, which is a
 * breakdown only: a read's own goal slugs own that clause.
 */
export const everyOperatorOn = (dimensions: Iterable<DimensionKey>): FilterOperatorMap =>
	Object.fromEntries(
		[...dimensions]
			.filter((dimension) => dimension !== 'goal')
			.map((dimension) => [dimension, FILTER_OPERATORS])
	)

/** The first of a read's dimensions `fields` maps, for a vendor that groups by one dimension. */
export const firstMapped = <Field>(
	dimensions: readonly DimensionKey[] | undefined,
	fields: Partial<Record<DimensionKey, Field>>
): { dimension: DimensionKey; field: Field } | undefined => {
	for (const dimension of dimensions ?? []) {
		const field = fields[dimension]
		if (field !== undefined) {
			return { dimension, field }
		}
	}
	return undefined
}

/**
 * The read's filters the source declares, each with its vendor field. The engine refuses any other
 * before the adapter runs; one that slips through is dropped rather than thrown.
 */
export const declaredFilters = <Field>(
	capabilities: { filters?: FilterOperatorMap },
	filters: readonly AnalyticsFilter[] | undefined,
	fields: Partial<Record<DimensionKey, Field>>
): Array<{ filter: AnalyticsFilter; field: Field }> =>
	(filters ?? []).flatMap((filter) => {
		const field = supportsFilter(capabilities, filter) ? fields[filter.dimension] : undefined
		return field === undefined ? [] : [{ filter, field }]
	})

/** The read's metrics the source declares and reads under the read's breakdown, filters and page. */
export const readableMetrics = (
	capabilities: AnalyticsCapabilities,
	q: AnalyticsQuery,
	dimensions: readonly DimensionKey[]
): MetricKey[] => {
	const shape = { dimensions, filters: q.filters ?? [], path: q.path !== undefined }
	return q.metrics.filter(
		(metric) => capabilities.metrics.has(metric) && metricReaches(capabilities, metric, shape)
	)
}

/**
 * Vendor metric names, deduped: several contract metrics alias one (sessions and visits are both
 * Plausible's `visits`), so values are read back by name, not request index.
 */
export const providerMetricKeys = (
	metrics: readonly MetricKey[],
	map: Partial<Record<MetricKey, string | readonly string[]>>
): string[] => [...new Set(metrics.flatMap((metric) => map[metric] ?? []))]

/** The read's first and last day as `YYYY-MM-DD` in its reporting zone, for a vendor taking dates. */
export const calendarDays = (q: AnalyticsQuery): [start: string, end: string] => [
	zonedCalendarDay(q.dateRange.start, q.timezone),
	zonedCalendarDay(q.dateRange.end, q.timezone),
]
