import type { FilterOperator, MetricKey } from '../core/contract'
import type { TimeframePreset } from '../timeframe/presets'
import type { SingularKey } from './keys'
import { keys } from './keys'

export const METRIC_KEYS: Record<MetricKey, SingularKey> = {
	pageviews: keys.metricPageviews,
	visitors: keys.metricVisitors,
	visits: keys.metricVisits,
	sessions: keys.metricSessions,
	events: keys.metricEvents,
	avgDuration: keys.metricAvgDuration,
	visitDuration: keys.metricVisitDuration,
	bounceRate: keys.metricBounceRate,
	scrollDepth: keys.metricScrollDepth,
	conversions: keys.metricConversions,
	revenue: keys.metricRevenue,
	impressions: keys.metricImpressions,
	interactions: keys.metricInteractions,
}

/**
 * Label key a metric reads under. Visitors summed over days (`meta.visitorsAre` is `sumOfDaily`)
 * get their own name, as one person on two days counts twice.
 */
export const metricLabelKey = (metric: MetricKey, visitorsSummed = false): SingularKey =>
	metric === 'visitors' && visitorsSummed ? keys.metricVisitorsSummed : METRIC_KEYS[metric]

/** Read as a sentence next to the dimension: "country is DE", "page contains /blog". */
export const FILTER_OPERATOR_KEYS: Record<FilterOperator, SingularKey> = {
	eq: keys.filterOperatorEq,
	contains: keys.filterOperatorContains,
	matches: keys.filterOperatorMatches,
}

export const TIMEFRAME_KEYS: Record<TimeframePreset, SingularKey> = {
	today: keys.timeframeToday,
	last7days: keys.timeframeLast7Days,
	last30days: keys.timeframeLast30Days,
	last90days: keys.timeframeLast90Days,
	thisMonth: keys.timeframeThisMonth,
	thisYear: keys.timeframeThisYear,
	lastYear: keys.timeframeLastYear,
	allTime: keys.timeframeAllTime,
}
