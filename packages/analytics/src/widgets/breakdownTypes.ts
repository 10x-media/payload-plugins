import type { DimensionKey, MetricKey } from '../core/contract'
import type { TimeframePreset } from '../timeframe/presets'
import { keys, type TranslationKey } from '../translations/keys'

export interface BreakdownWidgetData {
	title?: string
	metric?: MetricKey
	timeframe?: TimeframePreset
	limit?: number
	dataSource?: string
}

export interface BreakdownSpec {
	slug: string
	dimension: DimensionKey
	label: TranslationKey
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
]

export const breakdownSpecBySlug = (slug: string): BreakdownSpec | undefined =>
	BREAKDOWN_SPECS.find((s) => s.slug === slug)
