import type { Block, CollectionConfig, Config, Plugin } from 'payload'
import { type AnalyticsPluginOptions, type Goal, goalField } from '../../src/index'

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

/**
 * The dev site's page-to-path mapping: `home` is the site root, every other page hangs off
 * its slug. Shared by the analytics binding and the frontend's own links, so a document's
 * Analytics tab reads the same path the visitor loaded.
 */
export const pagePath = (doc: { slug?: unknown }): string | null =>
	typeof doc.slug === 'string' && doc.slug ? (doc.slug === 'home' ? '/' : `/${doc.slug}`) : null

/** Binds the `pages` collection's slug field to its public path, shared by both fragments. */
export const sharedBindings: AnalyticsPluginOptions['collections'] = {
	pages: { path: (doc) => pagePath(doc) },
}

/**
 * One conversion goal per match kind: an explicit `trackGoal` from the home page's CTA
 * attribute, a named custom event, and a pageview whose path matches a pattern.
 */
export const sharedGoals: Goal[] = [
	{
		slug: 'book-demo',
		name: 'Book a demo',
		match: { kind: 'goal' },
		value: { fixed: 500 },
		currency: 'EUR',
	},
	{ slug: 'signup', name: 'Signup', match: { kind: 'event', name: 'signup' } },
	{ slug: 'thank-you', name: 'Thank-you page', match: { kind: 'path', pattern: '/thank-you' } },
]

/**
 * The dev site's one layout block. Its goal is picked with the plugin's own `goalField`, so
 * the picker is exercised where a real install puts it: nested in a block row, next to
 * ordinary text fields, rather than at the top level of a collection.
 */
export const ctaBlock: Block = {
	slug: 'cta',
	labels: { singular: 'CTA', plural: 'CTAs' },
	fields: [
		{ name: 'heading', type: 'text' },
		{ name: 'label', type: 'text', required: true, defaultValue: 'Book a demo' },
		goalField({ name: 'goal', required: true }),
	],
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
		data: { metric: 'pageviews', timeframe: 'last30days', compare: true },
	},
	{
		widgetSlug: 'analytics-trend',
		width: 'large',
		data: { metric: 'visitors', timeframe: 'last30days' },
	},
	{
		widgetSlug: 'analytics-goals',
		width: 'large',
		data: { timeframe: 'last30days', limit: '10', compare: true },
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
		// The one filtered widget: the same breakdown as above, narrowed to one country the
		// seed produces, so its rows are always a subset of the unfiltered pages widget's and
		// its caption carries the filter sentence.
		widgetSlug: 'analytics-breakdown-pages',
		width: 'medium',
		data: {
			title: 'Top pages in Germany',
			metric: 'pageviews',
			timeframe: 'last30days',
			limit: 5,
			filter: { dimension: 'country', operator: 'eq', value: 'DE' },
		},
	},
	{
		widgetSlug: 'analytics-breakdown-sources',
		width: 'medium',
		data: { metric: 'pageviews', timeframe: 'last30days', limit: 5 },
	},
	{
		// Visitors rather than pageviews: an acquisition mix is a question about people.
		widgetSlug: 'analytics-breakdown-channels',
		width: 'medium',
		data: { metric: 'visitors', timeframe: 'last30days', limit: 5 },
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
	{
		widgetSlug: 'analytics-breakdown-goals',
		width: 'medium',
		data: { metric: 'conversions', timeframe: 'last30days', limit: 5 },
	},
	{
		widgetSlug: 'analytics-breakdown-referrers',
		width: 'medium',
		data: { metric: 'pageviews', timeframe: 'last30days', limit: 5 },
	},
	{
		widgetSlug: 'analytics-breakdown-browsers',
		width: 'medium',
		data: { metric: 'pageviews', timeframe: 'last30days', limit: 5 },
	},
	{
		// A filter on one of the dimensions the native engine classifies at ingest, so the
		// filter surface is exercised on a derived value rather than only on a geo one.
		widgetSlug: 'analytics-breakdown-pages',
		width: 'medium',
		data: {
			title: 'Top pages in Chrome',
			metric: 'pageviews',
			timeframe: 'last30days',
			limit: 5,
			filter: { dimension: 'browser', operator: 'eq', value: 'chrome' },
		},
	},
	{
		widgetSlug: 'analytics-breakdown-campaigns',
		width: 'medium',
		data: { metric: 'pageviews', timeframe: 'last30days', limit: 5 },
	},
	{
		// The one widget on a window other than the view's own default, so its "Open in
		// Analytics" link carries a range rather than serializing away to the default.
		widgetSlug: 'analytics-breakdown-events',
		width: 'medium',
		data: { metric: 'events', timeframe: 'last7days', limit: 5 },
	},
	{ widgetSlug: 'dev-custom-sources', width: 'medium', data: {} },
]

/** What `payload.config.ts` needs from whichever tenancy mode is selected. */
export interface DevConfigFragment {
	collections: CollectionConfig[]
	plugins: Plugin[]
	dashboard: DashboardConfig
}
