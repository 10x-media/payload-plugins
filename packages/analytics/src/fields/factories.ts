import type { TabsField, UIField } from 'payload'
import type { MetricKey } from '../core/contract'
import type { TimeframePreset } from '../timeframe/presets'
import { keys } from '../translations/keys'
import { labelForKey } from '../translations/server'

const RSC_PATH = '@10x-media/analytics/rsc#AnalyticsStatField'

const DEFAULT_ROW_METRICS: MetricKey[] = ['pageviews', 'visitors', 'sessions', 'avgDuration']

interface StatServerProps {
	metrics: MetricKey[]
	timeframe: TimeframePreset
	variant: 'stat' | 'row'
	adapterId?: string
}

interface BaseFieldOptions {
	timeframe?: TimeframePreset
	adapter?: string
	position?: 'sidebar'
	name?: string
}

export interface AnalyticsStatOptions extends BaseFieldOptions {
	metric: MetricKey
}

export interface AnalyticsStatRowOptions extends BaseFieldOptions {
	metrics?: MetricKey[]
}

export interface AnalyticsFieldsOptions {
	metrics?: MetricKey[]
	timeframe?: TimeframePreset
	adapter?: string
}

export interface AnalyticsTabOptions {
	metrics?: MetricKey[]
	timeframe?: TimeframePreset
	adapter?: string
}

const statField = (name: string, serverProps: StatServerProps, position?: 'sidebar'): UIField => ({
	name,
	type: 'ui',
	admin: {
		...(position ? { position } : {}),
		components: {
			Field: { path: RSC_PATH, serverProps },
		},
	},
})

export const analyticsStat = (options: AnalyticsStatOptions): UIField =>
	statField(
		options.name ?? `analytics_${options.metric}`,
		{
			metrics: [options.metric],
			timeframe: options.timeframe ?? 'last30days',
			variant: 'stat',
			adapterId: options.adapter,
		},
		options.position
	)

export const analyticsStatRow = (options: AnalyticsStatRowOptions = {}): UIField =>
	statField(
		options.name ?? 'analytics_stats',
		{
			metrics: options.metrics ?? DEFAULT_ROW_METRICS,
			timeframe: options.timeframe ?? 'last30days',
			variant: 'row',
			adapterId: options.adapter,
		},
		options.position
	)

export const analyticsFields = (options: AnalyticsFieldsOptions = {}): UIField[] =>
	(options.metrics ?? DEFAULT_ROW_METRICS).map((metric) =>
		analyticsStat({
			metric,
			timeframe: options.timeframe,
			adapter: options.adapter,
			name: `analytics_${metric}`,
		})
	)

export const analyticsTab = (options: AnalyticsTabOptions = {}): TabsField => ({
	type: 'tabs',
	tabs: [
		{
			label: labelForKey(keys.tabAnalytics),
			fields: [
				analyticsStatRow({
					metrics: options.metrics,
					timeframe: options.timeframe,
					adapter: options.adapter,
				}),
			],
		},
	],
})
