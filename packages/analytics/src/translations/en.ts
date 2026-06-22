import { keys, type TranslationKey } from './keys'

/**
 * English values, keyed by the typed constants in `keys.ts` so the two stay in
 * lockstep. The `Record<TranslationKey, string>` annotation makes a missing or
 * unknown key a type error. `translations/index.ts` nests these for Payload.
 */
export const en: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Analytics',
	[keys.tabAnalytics]: 'Analytics',
	[keys.metricPageviews]: 'Pageviews',
	[keys.metricVisitors]: 'Visitors',
	[keys.metricSessions]: 'Sessions',
	[keys.metricEvents]: 'Events',
	[keys.metricAvgDuration]: 'Avg. time',
	[keys.metricBounceRate]: 'Bounce rate',
	[keys.metricEntries]: 'Entries',
	[keys.metricExits]: 'Exits',
	[keys.metricScrollDepth]: 'Scroll depth',
	[keys.metricConversions]: 'Conversions',
	[keys.metricRevenue]: 'Revenue',
	[keys.stateNoData]: 'No analytics yet',
	[keys.stateNotBound]: 'Analytics not configured for this collection',
	[keys.stateNotConfigured]: 'Connect an analytics provider',
	[keys.stateUnavailable]: 'Not available for this data source',
	[keys.timeframeToday]: 'Today',
	[keys.timeframeLast7Days]: 'Last 7 days',
	[keys.timeframeLast30Days]: 'Last 30 days',
	[keys.timeframeLast90Days]: 'Last 90 days',
	[keys.timeframeThisMonth]: 'This month',
	[keys.timeframeThisYear]: 'This year',
	[keys.timeframeLastYear]: 'Last year',
	[keys.timeframeAllTime]: 'All time',
	[keys.widgetMetricLabel]: 'Metric',
	[keys.widgetFieldTitle]: 'Title',
	[keys.widgetFieldMetric]: 'Metric',
	[keys.widgetFieldTimeframe]: 'Timeframe',
	[keys.widgetFieldDataSource]: 'Data source',
}
