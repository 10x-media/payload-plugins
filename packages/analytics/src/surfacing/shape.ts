import type { AnalyticsQuery, AnalyticsResult, AnalyticsRow } from '../core/contract'
import { sortRowsByMetric } from '../core/metricValues'

/** A breakdown's rows: grouped by a dimension, with no timestamp, so their order is a ranking. */
const isRanking = (query: AnalyticsQuery, rows: readonly AnalyticsRow[]): boolean =>
	(query.dimensions?.length ?? 0) > 0 && rows.every((row) => row.timestamp === undefined)

/**
 * A breakdown ranked by `order` (no value last, ties in source order, first metric descending
 * when only `limit` is set) and cut to `limit`; an `order` on an unasked metric keeps source order.
 */
export const shapeResult = (result: AnalyticsResult, query: AnalyticsQuery): AnalyticsResult => {
	const limit =
		query.limit !== undefined && Number.isInteger(query.limit) && query.limit > 0
			? query.limit
			: undefined
	if (!isRanking(query, result.rows) || (limit === undefined && query.order === undefined)) {
		return result
	}
	const metric = query.order?.metric ?? query.metrics[0]
	const ranked =
		metric === undefined
			? result.rows
			: sortRowsByMetric(result.rows, metric, query.order?.direction ?? 'desc')
	return { ...result, rows: limit === undefined ? ranked : ranked.slice(0, limit) }
}
