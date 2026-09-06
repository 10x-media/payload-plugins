import type { CollectionConfig, Config, Plugin } from 'payload'
import type { AnalyticsPluginOptions } from '../../src/index'

/**
 * Shared with the plugin's `reportingTimezone` option in both dev config fragments and
 * with the seed (seeding bypasses the ingest endpoint, so events carry the zone
 * explicitly; otherwise their rollups bucket on UTC days and a "Today" read aligned to
 * this zone misses them).
 */
export const DEV_REPORTING_TIMEZONE = 'America/New_York'

/** The dev app's one custom widget, registered identically in both tenancy modes. */
export const sharedWidgets: NonNullable<AnalyticsPluginOptions['widgets']> = {
	register: [
		{
			slug: 'dev-custom-sources',
			component: '/components/DevCustomWidget#default',
			label: 'Custom: Top sources',
			requires: { dimensions: ['source'] },
		},
	],
}

/** Binds the `pages` collection's slug field to its public path, shared by both fragments. */
export const sharedBindings: AnalyticsPluginOptions['collections'] = {
	pages: { path: (doc) => (doc.slug ? `/${doc.slug as string}` : null) },
}

type DashboardConfig = NonNullable<NonNullable<Config['admin']>['dashboard']>
type DashboardLayout = Extract<DashboardConfig['defaultLayout'], unknown[]>

/** The dashboard widget layout, identical whether the install is single-tenant or scoped. */
export const sharedDashboardLayout: DashboardLayout = [
	{
		widgetSlug: 'analytics-realtime',
		width: 'small',
		data: { metric: 'visitors', windowMinutes: '30' },
	},
	{
		widgetSlug: 'analytics-trend',
		width: 'large',
		data: { metric: 'pageviews', timeframe: 'last30days' },
	},
	{
		widgetSlug: 'analytics-trend',
		width: 'large',
		data: { metric: 'visitors', timeframe: 'last30days' },
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
		widgetSlug: 'analytics-metric',
		width: 'small',
		data: { metric: 'sessions', timeframe: 'last30days' },
	},
	{
		widgetSlug: 'analytics-metric',
		width: 'small',
		data: { metric: 'avgDuration', timeframe: 'last30days' },
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
	{ widgetSlug: 'dev-custom-sources', width: 'medium', data: {} },
]

/** What `payload.config.ts` needs from whichever tenancy mode is selected. */
export interface DevConfigFragment {
	collections: CollectionConfig[]
	plugins: Plugin[]
	dashboard: DashboardConfig
}
