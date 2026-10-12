import type { WidgetInstance } from 'payload'

const TIMEFRAME = 'last30days'

/** The data every breakdown card opens with: its dimension's top five by pageviews. */
const BREAKDOWN_DATA = { metric: 'pageviews', timeframe: TIMEFRAME, limit: 5 } as const

/**
 * Every built-in widget, for the app to spread into its own `admin.dashboard.defaultLayout`.
 * Slugs stay literal (not mapped from `BREAKDOWN_SPECS`) so app-narrowed `widgetSlug` types fit.
 *
 * @beta
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
