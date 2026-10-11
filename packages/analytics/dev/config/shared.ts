// biome-ignore-all lint/plugin/noProcessEnv: dev app env boundary

import {
	type AnalyticsBinding,
	type AnalyticsPluginOptions,
	type CaptureGate,
	type CurrencyConverter,
	type Goal,
	goalField,
} from '@10x-media/analytics'
import type { Block, CollectionConfig, Config, PayloadRequest, Plugin } from 'payload'

/** The seeded admin, which the tenancy config also treats as platform staff with every tenant. */
export const DEV_ADMIN_EMAIL = 'dev@10xmedia.de'

/** The install's reporting zone, which the seed also aggregates its days in. */
export const DEV_REPORTING_TIMEZONE = 'America/New_York'

/** The install's `revenue.currency`, which every goal's fixed value and the seed's amounts use. */
export const DEV_REPORTING_CURRENCY = 'EUR'

/** Fixed demo rates into the reporting currency; a real install asks its own FX source. */
const DEV_RATES_TO_EUR: ReadonlyMap<string, number> = new Map([
	['USD', 0.92],
	['GBP', 1.17],
])

/**
 * The dev app's `revenue.convert`, shared with the seed: a sale sent in dollars or pounds is
 * summed in euros, its amount as sent kept beside it.
 */
export const devConvert: CurrencyConverter = ({ amount, from, to }) => {
	const rate = to === DEV_REPORTING_CURRENCY ? DEV_RATES_TO_EUR.get(from) : undefined
	return rate === undefined ? undefined : Math.round(amount * rate * 100) / 100
}

/**
 * Revenue in euros, with the `currency` dimension on. `ANALYTICS_REVENUE=off` is an install that
 * measures no money: no revenue metric, no currency dimension, no amount asked of an editor.
 * `book-demo` keeps its value either way, so that mode also shows the boot warning naming it.
 */
export const sharedRevenue: AnalyticsPluginOptions['revenue'] =
	process.env.ANALYTICS_REVENUE === 'off'
		? false
		: { currency: DEV_REPORTING_CURRENCY, convert: devConvert, dimension: true }

const gateMode = process.env.ANALYTICS_GATE

/**
 * The dev app's gate, a decision for this playground and not a default: native captures at once
 * and a vendor waits for the site's consent manager, the stand-in `ConsentToggle` on every site
 * page. `ANALYTICS_GATE=all` holds native too, so the toggle can be exercised by hand, and
 * `ANALYTICS_GATE=off` holds nothing.
 */
export const sharedGate: CaptureGate =
	gateMode === 'all' || gateMode === 'off' ? gateMode : ({ kind }) => kind !== 'native'

/**
 * Playwright's browser says it is automated, which the tracker leaves uncounted by default; the
 * e2e run sets `ANALYTICS_COUNT_AUTOMATION=1` so the hits it asserts on are stored. A browser
 * opened by hand is counted either way.
 */
export const sharedSkip: NonNullable<AnalyticsPluginOptions['capture']>['skip'] =
	process.env.ANALYTICS_COUNT_AUTOMATION === '1' ? { automation: false } : undefined

/**
 * A dev site's address beside the admin's own: the same port, on `<label>.localhost` for a
 * tenant's site or on the admin's own host without one. A real install names its domains.
 */
export const devSiteAddress = (req: PayloadRequest, label?: string): string => {
	const [host = 'localhost', port] = (req.headers.get('host') ?? 'localhost').split(':')
	const name = label ? `${label}.localhost` : host
	return `http://${name}${port ? `:${port}` : ''}`
}

const customize = process.env.ANALYTICS_CUSTOMIZE === 'on'

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
	...(customize
		? {
				overrides: {
					'analytics-breakdown-countries': {
						label: { en: 'Where visitors are', de: 'Woher Besucher kommen' },
					},
				},
			}
		: {}),
}

/**
 * Every customization point a host has, switched on with `ANALYTICS_CUSTOMIZE=on`: emoji flags in
 * place of the plugin's own artwork, a view body of the dev app's own composed from the exported
 * sections, and the countries widget renamed (above). Off, the dev app shows the plugin as it
 * ships. Both components are in the import map either way.
 */
export const sharedCustomizing: Pick<AnalyticsPluginOptions, 'countryFlags' | 'view'> = customize
	? {
			countryFlags: { Component: '/components/DevCountryFlag#DevCountryFlag' },
			view: { Component: '/components/DevAnalyticsView#DevAnalyticsView' },
		}
	: {}

/**
 * The dev site's page-to-path mapping: `home` is the site root, every other page hangs off
 * its slug. Shared by the analytics binding and the frontend's own links, so a document's
 * Analytics tab reads the same path the visitor loaded.
 */
export const pagePath = ({ slug }: { slug?: unknown }): string | null => {
	if (typeof slug !== 'string' || !slug) {
		return null
	}
	return slug === 'home' ? '/' : `/${slug}`
}

export const pagesBinding: AnalyticsBinding<'pages'> = { path: pagePath }

/**
 * One conversion goal per match kind: an explicit `trackGoal` from the home page's CTA
 * attribute, a named custom event, and a pageview whose path matches a pattern. The seed's
 * sales are booked against the plugin's built-in `purchase` goal, which is exactly what an
 * install that defines nothing gets.
 */
export const sharedGoals: Goal[] = [
	{
		slug: 'book-demo',
		name: 'Book a demo',
		match: { kind: 'goal' },
		value: { fixed: 500 },
		currency: DEV_REPORTING_CURRENCY,
	},
	{ slug: 'signup', name: 'Signup', match: { kind: 'event', name: 'signup' } },
	{ slug: 'thank-you', name: 'Thank-you page', match: { kind: 'path', pattern: '/thank-you' } },
]

/**
 * The goal an offer card's button completes, and the one the seeded offer conversions book. A
 * config goal, so it counts under either tenant, and it carries a value, so revenue shows.
 */
export const OFFER_GOAL = 'book-demo'

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

/**
 * The dashboard layout for both tenancy modes, in whole rows (x-small a quarter, small a third,
 * medium a half, large two thirds), so no row ends in a gap: keep that arithmetic when adding a
 * widget.
 */
export const sharedDashboardLayout: DashboardLayout = [
	{
		widgetSlug: 'analytics-metric',
		width: 'x-small',
		data: { metric: 'pageviews', timeframe: 'last30days' },
	},
	{
		widgetSlug: 'analytics-metric',
		width: 'x-small',
		data: { metric: 'visitors', timeframe: 'last30days' },
	},
	{
		widgetSlug: 'analytics-metric',
		width: 'x-small',
		data: { metric: 'sessions', timeframe: 'last30days' },
	},
	{
		widgetSlug: 'analytics-metric',
		width: 'x-small',
		data: { metric: 'avgDuration', timeframe: 'last30days' },
	},
	{
		widgetSlug: 'analytics-trend',
		width: 'large',
		data: { metric: 'pageviews', timeframe: 'last30days', compare: true },
	},
	{
		widgetSlug: 'analytics-realtime',
		width: 'small',
		data: { metric: 'visitors', windowMinutes: '30' },
	},
	{
		widgetSlug: 'analytics-trend',
		width: 'large',
		data: { metric: 'visitors', timeframe: 'last30days' },
	},
	{
		// The one widget off the view's default window, so its link carries a range.
		widgetSlug: 'analytics-breakdown-events',
		width: 'small',
		data: { metric: 'events', timeframe: 'last7days', limit: 5 },
	},
	{
		widgetSlug: 'analytics-goals',
		width: 'large',
		data: { timeframe: 'last30days', limit: '10', compare: true },
	},
	{
		widgetSlug: 'analytics-breakdown-countries',
		width: 'small',
		data: { metric: 'pageviews', timeframe: 'last30days', limit: 5 },
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
		width: 'small',
		data: { metric: 'pageviews', timeframe: 'last30days', limit: 5 },
	},
	{
		widgetSlug: 'analytics-breakdown-browsers',
		width: 'small',
		data: { metric: 'pageviews', timeframe: 'last30days', limit: 5 },
	},
	{
		widgetSlug: 'analytics-breakdown-goals',
		width: 'small',
		data: { metric: 'conversions', timeframe: 'last30days', limit: 5 },
	},
	{
		widgetSlug: 'analytics-breakdown-referrers',
		width: 'medium',
		data: { metric: 'pageviews', timeframe: 'last30days', limit: 5 },
	},
	{
		// Eight, the seed's campaign count, so every campaign it lands is on the dashboard.
		widgetSlug: 'analytics-breakdown-campaigns',
		width: 'medium',
		data: { metric: 'pageviews', timeframe: 'last30days', limit: 8 },
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
	{ widgetSlug: 'dev-custom-sources', width: 'medium', data: {} },
]

/**
 * `ANALYTICS_SLOW_SOURCE_MS` makes the memory source answer that late and the default, for the e2e
 * check that an edit view and the dashboard paint without waiting on it. Single-site mode only.
 */
export const slowSourceMs = (): number | undefined => {
	const raw = Number(process.env.ANALYTICS_SLOW_SOURCE_MS)
	return Number.isInteger(raw) && raw > 0 ? raw : undefined
}

/** Two cards, one on the native engine and one on the slowed memory source, for that e2e check. */
export const slowSourceDashboardLayout: DashboardLayout = [
	{
		widgetSlug: 'analytics-metric',
		width: 'small',
		data: {
			title: 'Native pageviews',
			metric: 'pageviews',
			timeframe: 'last30days',
			dataSource: 'native',
		},
	},
	{
		widgetSlug: 'analytics-metric',
		width: 'small',
		data: {
			title: 'Slow pageviews',
			metric: 'pageviews',
			timeframe: 'last30days',
			dataSource: 'memory',
		},
	},
]

/** What `payload.config.ts` needs from whichever tenancy mode is selected. */
export interface DevConfigFragment {
	collections: CollectionConfig[]
	plugins: Plugin[]
	dashboard: DashboardConfig
}
