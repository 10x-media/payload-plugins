import type { DimensionKey, MetricKey } from '../core/contract'
import type { TimeframePreset } from '../timeframe/presets'
import { keys, type TranslationKey } from '../translations/keys'
import type { WidgetFilter, WidgetRange } from './types'

export interface BreakdownWidgetData {
	title?: string
	metric?: MetricKey
	timeframe?: TimeframePreset | 'custom'
	range?: WidgetRange
	limit?: number
	dataSource?: string
	filter?: WidgetFilter
}

export interface BreakdownSpec {
	slug: string
	dimension: DimensionKey
	label: TranslationKey
	preferredDefault?: MetricKey
}

export const BREAKDOWN_SPECS: BreakdownSpec[] = [
	{ slug: 'analytics-breakdown-pages', dimension: 'page', label: keys.widgetBreakdownPages },
	{ slug: 'analytics-breakdown-sources', dimension: 'source', label: keys.widgetBreakdownSources },
	{ slug: 'analytics-breakdown-devices', dimension: 'device', label: keys.widgetBreakdownDevices },
	{
		slug: 'analytics-breakdown-countries',
		dimension: 'country',
		label: keys.widgetBreakdownCountries,
	},
	{
		slug: 'analytics-breakdown-goals',
		dimension: 'goal',
		label: keys.widgetBreakdownGoals,
		// A goals breakdown is a conversion table: pageviews per goal is a stranger default.
		preferredDefault: 'conversions',
	},
	{
		slug: 'analytics-breakdown-referrers',
		dimension: 'referrer',
		label: keys.widgetBreakdownReferrers,
	},
	{
		slug: 'analytics-breakdown-browsers',
		dimension: 'browser',
		label: keys.widgetBreakdownBrowsers,
	},
	{ slug: 'analytics-breakdown-os', dimension: 'os', label: keys.widgetBreakdownOs },
	{
		slug: 'analytics-breakdown-campaigns',
		dimension: 'utmCampaign',
		label: keys.widgetBreakdownCampaigns,
	},
	{
		slug: 'analytics-breakdown-events',
		dimension: 'event',
		label: keys.widgetBreakdownEvents,
		preferredDefault: 'events',
	},
]

export const breakdownSpecBySlug = (slug: string): BreakdownSpec | undefined =>
	BREAKDOWN_SPECS.find((s) => s.slug === slug)
