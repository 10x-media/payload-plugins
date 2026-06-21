import type { MetricKey } from '../core/contract'
import type { TimeframePreset } from '../timeframe/presets'
import type { TranslationKey } from './keys'
import { keys } from './keys'

export const METRIC_KEYS: Record<MetricKey, TranslationKey> = {
	pageviews: keys.metricPageviews,
	visitors: keys.metricVisitors,
	visits: keys.metricVisitors,
	sessions: keys.metricSessions,
	events: keys.metricEvents,
	avgDuration: keys.metricAvgDuration,
	bounceRate: keys.metricBounceRate,
	entries: keys.metricEntries,
	exits: keys.metricExits,
	scrollDepth: keys.metricScrollDepth,
	conversions: keys.metricConversions,
	revenue: keys.metricRevenue,
}

export const TIMEFRAME_KEYS: Record<TimeframePreset, TranslationKey> = {
	today: keys.timeframeToday,
	last7days: keys.timeframeLast7Days,
	last30days: keys.timeframeLast30Days,
	last90days: keys.timeframeLast90Days,
	thisMonth: keys.timeframeThisMonth,
	thisYear: keys.timeframeThisYear,
}
