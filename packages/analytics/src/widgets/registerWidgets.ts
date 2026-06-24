import type { Config, Field, Widget, WidgetWidth } from 'payload'
import { type CapabilityRequirement, satisfiesCapabilities } from '../core/capabilities'
import type { AnalyticsAdapter } from '../core/contract'
import { dateRangeField } from '../fields/dateRange/field'
import { TIMEFRAME_PRESETS } from '../timeframe/presets'
import { en } from '../translations/en'
import type { TranslationKey } from '../translations/keys'
import { keys } from '../translations/keys'
import { METRIC_KEYS, TIMEFRAME_KEYS } from '../translations/metricKeys'
import { labelForKey } from '../translations/server'
import { BREAKDOWN_SPECS, type BreakdownSpec } from './breakdownTypes'
import { buildCustomWidgets, type CustomWidgetDef } from './customWidget'
import { WIDGET_METRICS } from './types'

export interface RegisterWidgetsArgs {
	adapters: AnalyticsAdapter[]
	multiProvider: boolean
	disabled: string[]
	register: CustomWidgetDef[]
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
		{
			name: 'title',
			type: 'text',
			label: labelForKey(keys.widgetFieldTitle),
			admin: { placeholder: en[keys.widgetFieldTitlePlaceholder] },
		},
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
			options: [
				...TIMEFRAME_PRESETS.map((p) => ({ value: p, label: labelForKey(TIMEFRAME_KEYS[p]) })),
				{ value: 'custom', label: labelForKey(keys.widgetTimeframeCustom) },
			],
		},
		dateRangeField({
			name: 'range',
			label: labelForKey(keys.widgetFieldRange),
			pickerAppearance: 'dayOnly',
			overrides: (f) => ({
				...f,
				admin: {
					...f.admin,
					condition: (_data, siblingData) => siblingData?.timeframe === 'custom',
				},
			}),
		}),
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

const breakdownWidgetFields = (args: RegisterWidgetsArgs, spec: BreakdownSpec): Field[] => {
	const fields: Field[] = [
		{
			name: 'title',
			type: 'text',
			label: labelForKey(keys.widgetFieldTitle),
			admin: { placeholder: en[spec.label] },
		},
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
			options: [
				...TIMEFRAME_PRESETS.map((p) => ({ value: p, label: labelForKey(TIMEFRAME_KEYS[p]) })),
				{ value: 'custom', label: labelForKey(keys.widgetTimeframeCustom) },
			],
		},
		dateRangeField({
			name: 'range',
			label: labelForKey(keys.widgetFieldRange),
			pickerAppearance: 'dayOnly',
			overrides: (f) => ({
				...f,
				admin: {
					...f.admin,
					condition: (_data, siblingData) => siblingData?.timeframe === 'custom',
				},
			}),
		}),
		{
			name: 'limit',
			type: 'number',
			defaultValue: 5,
			min: 1,
			max: 20,
			label: labelForKey(keys.widgetFieldLimit),
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

const realtimeWidgetFields = (args: RegisterWidgetsArgs): Field[] => {
	const fields: Field[] = [
		{
			name: 'title',
			type: 'text',
			label: labelForKey(keys.widgetFieldTitle),
			admin: { placeholder: en[keys.widgetFieldTitlePlaceholder] },
		},
		{
			name: 'metric',
			type: 'select',
			required: true,
			defaultValue: 'visitors',
			label: labelForKey(keys.widgetFieldMetric),
			options: [
				{ value: 'visitors', label: labelForKey(METRIC_KEYS.visitors) },
				{ value: 'pageviews', label: labelForKey(METRIC_KEYS.pageviews) },
			],
		},
		{
			name: 'windowMinutes',
			type: 'select',
			defaultValue: '30',
			label: labelForKey(keys.widgetFieldWindow),
			options: [
				{ value: '5', label: '5 min' },
				{ value: '15', label: '15 min' },
				{ value: '30', label: '30 min' },
				{ value: '60', label: '60 min' },
			],
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
	{
		slug: 'analytics-realtime',
		component: '@10x-media/analytics/rsc#AnalyticsRealtimeWidget',
		label: keys.widgetRealtimeLabel,
		requires: { realtime: true },
		minWidth: 'small' as WidgetWidth,
		maxWidth: 'medium' as WidgetWidth,
		fields: realtimeWidgetFields,
	},
	...BREAKDOWN_SPECS.map(
		(spec): WidgetDef => ({
			slug: spec.slug,
			component: '@10x-media/analytics/rsc#AnalyticsBreakdownWidget',
			label: spec.label,
			requires: { dimensions: [spec.dimension] },
			minWidth: 'small' as WidgetWidth,
			maxWidth: 'large' as WidgetWidth,
			fields: (args) => breakdownWidgetFields(args, spec),
		})
	),
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
	built.push(...buildCustomWidgets(args.register, args.adapters, args.disabled))
	if (!built.length) {
		return
	}
	config.admin ??= {}
	config.admin.dashboard ??= { widgets: [] }
	config.admin.dashboard.widgets ??= []
	config.admin.dashboard.widgets.push(...built)
}
