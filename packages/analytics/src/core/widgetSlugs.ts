import { isOneOf } from './values'

/**
 * Every dashboard widget the plugin registers itself, in the order the widget list shows them.
 *
 * @beta
 */
export const BUILT_IN_WIDGET_SLUGS = [
	'analytics-metric',
	'analytics-trend',
	'analytics-realtime',
	'analytics-goals',
	'analytics-breakdown-pages',
	'analytics-breakdown-sources',
	'analytics-breakdown-channels',
	'analytics-breakdown-devices',
	'analytics-breakdown-countries',
	'analytics-breakdown-goals',
	'analytics-breakdown-referrers',
	'analytics-breakdown-browsers',
	'analytics-breakdown-os',
	'analytics-breakdown-campaigns',
	'analytics-breakdown-events',
] as const

/**
 * A dashboard widget the plugin registers itself, which `widgets.disabled` leaves out and
 * `widgets.overrides` changes. Open: a minor release may add one.
 *
 * @beta
 */
export type BuiltInWidgetSlug = (typeof BUILT_IN_WIDGET_SLUGS)[number]

export const isBuiltInWidgetSlug = (slug: string): slug is BuiltInWidgetSlug =>
	isOneOf(BUILT_IN_WIDGET_SLUGS, slug)
