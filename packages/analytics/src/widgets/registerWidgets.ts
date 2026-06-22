import type { Config, Field, Widget, WidgetWidth } from 'payload'
import { type CapabilityRequirement, satisfiesCapabilities } from '../core/capabilities'
import type { AnalyticsAdapter } from '../core/contract'
import { TIMEFRAME_PRESETS } from '../timeframe/presets'
import type { TranslationKey } from '../translations/keys'
import { keys } from '../translations/keys'
import { METRIC_KEYS, TIMEFRAME_KEYS } from '../translations/metricKeys'
import { labelForKey } from '../translations/server'
import { WIDGET_METRICS } from './types'

export interface RegisterWidgetsArgs {
	adapters: AnalyticsAdapter[]
	multiProvider: boolean
	disabled: string[]
}

interface WidgetDef {
	slug: string
	component: string
	label: TranslationKey
	requires?: CapabilityRequirement
	minWidth?: WidgetWidth
	maxWidth?: WidgetWidth
	fields: (args: RegisterWidgetsArgs) => Field[]
}

export const widgetIsSupported = (
	requires: CapabilityRequirement | undefined,
	adapters: AnalyticsAdapter[]
): boolean => !requires || adapters.some((a) => satisfiesCapabilities(a.capabilities, requires))

const metricWidgetFields = (args: RegisterWidgetsArgs): Field[] => {
	const fields: Field[] = [
		{ name: 'title', type: 'text', label: labelForKey(keys.widgetFieldTitle) },
		{
			name: 'metric',
			type: 'select',
			required: true,
			defaultValue: 'pageviews',
			label: labelForKey(keys.widgetFieldMetric),
			options: WIDGET_METRICS.map((m) => ({ value: m, label: labelForKey(METRIC_KEYS[m]) })),
		},
		{
			name: 'timeframe',
			type: 'select',
			required: true,
			defaultValue: 'last30days',
			label: labelForKey(keys.widgetFieldTimeframe),
			options: TIMEFRAME_PRESETS.map((p) => ({ value: p, label: labelForKey(TIMEFRAME_KEYS[p]) })),
		},
	]
	if (args.multiProvider) {
		fields.push({
			name: 'dataSource',
			type: 'select',
			label: labelForKey(keys.widgetFieldDataSource),
			defaultValue: args.adapters[0]?.id,
			options: args.adapters.map((a) => ({ value: a.id, label: a.label })),
		})
	}
	return fields
}

const WIDGET_DEFS: WidgetDef[] = [
	{
		slug: 'analytics-metric',
		component: '@10x-media/analytics/rsc#AnalyticsMetricWidget',
		label: keys.widgetMetricLabel,
		minWidth: 'x-small',
		maxWidth: 'medium',
		fields: metricWidgetFields,
	},
	{
		slug: 'analytics-trend',
		component: '@10x-media/analytics/rsc#AnalyticsTrendWidget',
		label: keys.widgetTrendLabel,
		requires: { metrics: ['pageviews'] },
		minWidth: 'small',
		maxWidth: 'full',
		fields: metricWidgetFields,
	},
]

export const registerWidgets = (config: Config, args: RegisterWidgetsArgs): void => {
	const built: Widget[] = []
	for (const def of WIDGET_DEFS) {
		if (args.disabled.includes(def.slug)) {
			continue
		}
		if (!widgetIsSupported(def.requires, args.adapters)) {
			continue
		}
		built.push({
			slug: def.slug,
			Component: def.component,
			label: labelForKey(def.label),
			fields: def.fields(args),
			minWidth: def.minWidth,
			maxWidth: def.maxWidth,
		})
	}
	if (!built.length) {
		return
	}
	config.admin ??= {}
	config.admin.dashboard ??= { widgets: [] }
	config.admin.dashboard.widgets ??= []
	config.admin.dashboard.widgets.push(...built)
}
