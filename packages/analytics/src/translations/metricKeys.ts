import type { FilterOperator, MetricKey } from '../core/contract'
import type { TimeframePreset } from '../timeframe/presets'
import type { TranslationKey } from './keys'
import { keys } from './keys'

export const METRIC_KEYS: Record<MetricKey, TranslationKey> = {
	pageviews: keys.metricPageviews,
	visitors: keys.metricVisitors,
	visits: keys.metricVisits,
	sessions: keys.metricSessions,
	events: keys.metricEvents,
	avgDuration: keys.metricAvgDuration,
	bounceRate: keys.metricBounceRate,
	scrollDepth: keys.metricScrollDepth,
	conversions: keys.metricConversions,
	revenue: keys.metricRevenue,
}

/** Read as a sentence next to the dimension: "country is DE", "page contains /blog". */
export const FILTER_OPERATOR_KEYS: Record<FilterOperator, TranslationKey> = {
	eq: keys.filterOperatorEq,
	contains: keys.filterOperatorContains,
	matches: keys.filterOperatorMatches,
}

export const TIMEFRAME_KEYS: Record<TimeframePreset, TranslationKey> = {
	today: keys.timeframeToday,
	last7days: keys.timeframeLast7Days,
	last30days: keys.timeframeLast30Days,
	last90days: keys.timeframeLast90Days,
	thisMonth: keys.timeframeThisMonth,
	thisYear: keys.timeframeThisYear,
	lastYear: keys.timeframeLastYear,
	allTime: keys.timeframeAllTime,
}
