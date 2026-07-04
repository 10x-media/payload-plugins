import type { Tab, TabsField, UIField } from 'payload'
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

type BaseFieldOptions = {
	timeframe?: TimeframePreset
	adapter?: string
	position?: 'sidebar'
	name?: string
}

export type AnalyticsStatOptions = BaseFieldOptions & {
	metric: MetricKey
}

export type AnalyticsStatRowOptions = BaseFieldOptions & {
	metrics?: MetricKey[]
}

export type AnalyticsFieldsOptions = {
	metrics?: MetricKey[]
	timeframe?: TimeframePreset
	adapter?: string
}

export type AnalyticsTabOptions = {
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

/**
 * An unnamed "Analytics" `Tab` to push into your own tabs field's `tabs` array.
 * Use {@link analyticsTabsField} for a standalone tabs field wrapping this tab.
 */
export const analyticsTab = (options: AnalyticsTabOptions = {}): Tab => ({
	label: labelForKey(keys.tabAnalytics),
	fields: [
		analyticsStatRow({
			metrics: options.metrics,
			timeframe: options.timeframe,
			adapter: options.adapter,
		}),
	],
})

/** A ready-made tabs field containing a single {@link analyticsTab}. */
export const analyticsTabsField = (options: AnalyticsTabOptions = {}): TabsField => ({
	type: 'tabs',
	tabs: [analyticsTab(options)],
})
