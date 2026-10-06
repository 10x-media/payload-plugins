import type { WidgetInstance } from 'payload'

const TIMEFRAME = 'last30days'

/** The data every breakdown card opens with: its dimension's top five by pageviews. */
const BREAKDOWN_DATA = { metric: 'pageviews', timeframe: TIMEFRAME, limit: 5 } as const

/**
 * Default analytics widget instances to spread into an app's own
 * `admin.dashboard.defaultLayout`: every built-in widget, headline numbers first, then the
 * trend, the goals table, the realtime counter and one card per breakdown. A plugin must
 * never set `defaultLayout` itself (Payload applies it with `??=`, so any setter would
 * clobber the app's layout). Each slug is spelled out rather than mapped from
 * `BREAKDOWN_SPECS`, because an app's generated types narrow `widgetSlug` to its own
 * registered widgets; `defaults.test.ts` is what keeps the list complete.
 */
export const analyticsDefaultWidgets = (): WidgetInstance[] => [
	{
		widgetSlug: 'analytics-metric',
		width: 'small',
		data: { metric: 'pageviews', timeframe: TIMEFRAME },
	},
	{
		widgetSlug: 'analytics-metric',
		width: 'small',
		data: { metric: 'visitors', timeframe: TIMEFRAME },
	},
	{
		widgetSlug: 'analytics-trend',
		width: 'large',
		data: { metric: 'pageviews', timeframe: TIMEFRAME },
	},
	{
		widgetSlug: 'analytics-goals',
		width: 'medium',
		// The goals table stores its row count as its select's own string value.
		data: { timeframe: TIMEFRAME, limit: '10' },
	},
	{
		widgetSlug: 'analytics-realtime',
		width: 'small',
		data: { metric: 'visitors', windowMinutes: '30' },
	},
	{ widgetSlug: 'analytics-breakdown-pages', width: 'medium', data: BREAKDOWN_DATA },
	{ widgetSlug: 'analytics-breakdown-sources', width: 'medium', data: BREAKDOWN_DATA },
	{
		widgetSlug: 'analytics-breakdown-channels',
		width: 'medium',
		data: { ...BREAKDOWN_DATA, metric: 'visitors' },
	},
	{ widgetSlug: 'analytics-breakdown-devices', width: 'medium', data: BREAKDOWN_DATA },
	{ widgetSlug: 'analytics-breakdown-countries', width: 'medium', data: BREAKDOWN_DATA },
	{
		widgetSlug: 'analytics-breakdown-goals',
		width: 'medium',
		data: { ...BREAKDOWN_DATA, metric: 'conversions' },
	},
	{ widgetSlug: 'analytics-breakdown-referrers', width: 'medium', data: BREAKDOWN_DATA },
	{ widgetSlug: 'analytics-breakdown-browsers', width: 'medium', data: BREAKDOWN_DATA },
	{ widgetSlug: 'analytics-breakdown-os', width: 'medium', data: BREAKDOWN_DATA },
	{ widgetSlug: 'analytics-breakdown-campaigns', width: 'medium', data: BREAKDOWN_DATA },
	{
		widgetSlug: 'analytics-breakdown-events',
		width: 'medium',
		data: { ...BREAKDOWN_DATA, metric: 'events' },
	},
]
