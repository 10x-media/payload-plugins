import type { WidgetInstance } from 'payload'

/**
 * Default analytics widget instances to spread into an app's own
 * `admin.dashboard.defaultLayout`. A plugin must never set `defaultLayout` itself
 * (Payload applies it with `??=`, so any setter would clobber the app's layout).
 */
export const analyticsDefaultWidgets = (): WidgetInstance[] => [
	{
		widgetSlug: 'analytics-trend',
		width: 'large',
		data: { metric: 'pageviews', timeframe: 'last30days' },
	},
	{
		widgetSlug: 'analytics-metric',
		width: 'small',
		data: { metric: 'pageviews', timeframe: 'last30days' },
	},
	{
		widgetSlug: 'analytics-metric',
		width: 'small',
		data: { metric: 'visitors', timeframe: 'last30days' },
	},
	{
		widgetSlug: 'analytics-breakdown-pages',
		width: 'medium',
		data: { metric: 'pageviews', timeframe: 'last30days', limit: 5 },
	},
	{
		widgetSlug: 'analytics-breakdown-sources',
		width: 'medium',
		data: { metric: 'pageviews', timeframe: 'last30days', limit: 5 },
	},
	{
		widgetSlug: 'analytics-breakdown-devices',
		width: 'medium',
		data: { metric: 'pageviews', timeframe: 'last30days', limit: 5 },
	},
	{
		widgetSlug: 'analytics-breakdown-countries',
		width: 'medium',
		data: { metric: 'pageviews', timeframe: 'last30days', limit: 5 },
	},
]
