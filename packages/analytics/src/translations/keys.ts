/**
 * Typed translation keys. Lookups must go through these constants, not string
 * literals (enforced by requireI18nKeysTyped.grit). Every key here must have a
 * value in every locale (`en.ts`), or it is a type error.
 */
export const keys = {
	pluginName: 'analytics:pluginName',
	tabAnalytics: 'analytics:tabAnalytics',
	metricPageviews: 'analytics:metricPageviews',
	metricVisitors: 'analytics:metricVisitors',
	metricSessions: 'analytics:metricSessions',
	metricEvents: 'analytics:metricEvents',
	metricAvgDuration: 'analytics:metricAvgDuration',
	metricBounceRate: 'analytics:metricBounceRate',
	metricEntries: 'analytics:metricEntries',
	metricExits: 'analytics:metricExits',
	metricScrollDepth: 'analytics:metricScrollDepth',
	metricConversions: 'analytics:metricConversions',
	metricRevenue: 'analytics:metricRevenue',
	stateNoData: 'analytics:stateNoData',
	stateNotBound: 'analytics:stateNotBound',
	stateNotConfigured: 'analytics:stateNotConfigured',
	stateUnavailable: 'analytics:stateUnavailable',
	timeframeToday: 'analytics:timeframeToday',
	timeframeLast7Days: 'analytics:timeframeLast7Days',
	timeframeLast30Days: 'analytics:timeframeLast30Days',
	timeframeLast90Days: 'analytics:timeframeLast90Days',
	timeframeThisMonth: 'analytics:timeframeThisMonth',
	timeframeThisYear: 'analytics:timeframeThisYear',
} as const

export type TranslationKey = (typeof keys)[keyof typeof keys]
