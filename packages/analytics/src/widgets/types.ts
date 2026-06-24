import type { MetricKey } from '../core/contract'
import type { TimeframePreset } from '../timeframe/presets'

export interface WidgetRange {
	from?: string
	to?: string
}

export interface MetricWidgetData {
	title?: string
	metric?: MetricKey
	timeframe?: TimeframePreset | 'custom'
	range?: WidgetRange
	dataSource?: string
}

export const WIDGET_METRICS: MetricKey[] = [
	'pageviews',
	'visitors',
	'sessions',
	'avgDuration',
	'bounceRate',
	'events',
]
