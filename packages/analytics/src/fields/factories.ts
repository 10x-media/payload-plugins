import type { LabelFunction, StaticLabel, Tab, TabsField, UIField, UnnamedTab } from 'payload'
import type { MetricKey } from '../core/contract'
import type { TimeframePreset } from '../timeframe/presets'
import { keys } from '../translations/keys'
import { labelForKey } from '../translations/server'

const RSC_PATH = '@10x-media/analytics/rsc#AnalyticsStatField'

const DEFAULT_ROW_METRICS: MetricKey[] = ['pageviews', 'visitors', 'sessions', 'avgDuration']

/**
 * A metric card label override: a plain string, a locale-to-label map, or a Payload
 * label function receiving `{ t, i18n }`. Defaults to the metric's translated name.
 */
export type AnalyticsMetricLabel = LabelFunction | StaticLabel

export type AnalyticsMetricLabels = Partial<Record<MetricKey, AnalyticsMetricLabel>>

interface StatServerProps {
	metrics: MetricKey[]
	timeframe: TimeframePreset
	variant: 'stat' | 'row'
	adapterId?: string
	labels?: AnalyticsMetricLabels
}

type BaseFieldOptions = {
	timeframe?: TimeframePreset
	adapter?: string
	position?: 'sidebar'
	name?: string
}

export type AnalyticsStatOptions = BaseFieldOptions & {
	metric: MetricKey
	/** Overrides the stat's metric card label. */
	label?: AnalyticsMetricLabel
}

export type AnalyticsStatRowOptions = BaseFieldOptions & {
	metrics?: MetricKey[]
	/** Per-metric card label overrides. */
	labels?: AnalyticsMetricLabels
}

export type AnalyticsFieldsOptions = {
	metrics?: MetricKey[]
	timeframe?: TimeframePreset
	adapter?: string
	/** Per-metric card label overrides. */
	labels?: AnalyticsMetricLabels
}

export type AnalyticsTabOptions = {
	metrics?: MetricKey[]
	timeframe?: TimeframePreset
	adapter?: string
	/** Overrides the tab label (default: the translated "Analytics"). */
	label?: UnnamedTab['label']
	/** Optional tab description. */
	description?: UnnamedTab['description']
	/** Per-metric card label overrides. */
	labels?: AnalyticsMetricLabels
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
			...(options.label ? { labels: { [options.metric]: options.label } } : {}),
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
			labels: options.labels,
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
			label: options.labels?.[metric],
		})
	)

/**
 * An unnamed "Analytics" `Tab` to push into your own tabs field's `tabs` array.
 * Use {@link analyticsTabsField} for a standalone tabs field wrapping this tab.
 */
export const analyticsTab = (options: AnalyticsTabOptions = {}): Tab => ({
	label: options.label ?? labelForKey(keys.tabAnalytics),
	...(options.description ? { description: options.description } : {}),
	fields: [
		analyticsStatRow({
			metrics: options.metrics,
			timeframe: options.timeframe,
			adapter: options.adapter,
			labels: options.labels,
		}),
	],
})

/** A ready-made tabs field containing a single {@link analyticsTab}. */
export const analyticsTabsField = (options: AnalyticsTabOptions = {}): TabsField => ({
	type: 'tabs',
	tabs: [analyticsTab(options)],
})
