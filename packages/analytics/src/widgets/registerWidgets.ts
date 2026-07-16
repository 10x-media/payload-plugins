import type { Config, Field, SelectField, Widget, WidgetWidth } from 'payload'
import { type CapabilityRequirement, satisfiesCapabilities } from '../core/capabilities'
import type { AnalyticsAdapter, MetricKey } from '../core/contract'
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
	localizeText?: boolean
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

/**
 * The widget metric select. Options are limited to metrics at least one configured
 * adapter can serve, mirroring the OR-across-adapters gating used to hide whole widgets;
 * `extra` layers on further requirements (a breakdown widget's dimension, realtime) so
 * the picker never offers a metric the read path would report as unavailable. In
 * multi-provider installs `filterOptions` additionally narrows the picker to the selected
 * `dataSource`'s capabilities; an id not known at config time (a runtime/DB provider)
 * keeps the union. The default clamps to the first option when the preferred metric is
 * not servable, and options can come out empty for exotic adapter sets, which
 * {@link registerWidgets} treats as "skip this widget".
 */
const metricSelectField = (
	candidates: MetricKey[],
	args: RegisterWidgetsArgs,
	opts: {
		extra?: Omit<CapabilityRequirement, 'metrics'>
		preferredDefault?: MetricKey
	} = {}
): Field => {
	const { extra, preferredDefault = 'pageviews' } = opts
	const supports = (adapter: AnalyticsAdapter, metric: MetricKey): boolean =>
		satisfiesCapabilities(adapter.capabilities, { ...extra, metrics: [metric] })
	const options = candidates
		.filter((m) => args.adapters.some((a) => supports(a, m)))
		.map((m) => ({ value: m, label: labelForKey(METRIC_KEYS[m]) }))
	const defaultValue = options.some((o) => o.value === preferredDefault)
		? preferredDefault
		: options[0]?.value
	const filterOptions: SelectField['filterOptions'] = ({ options: opts, siblingData }) => {
		const sourceId = (siblingData as { dataSource?: unknown } | undefined)?.dataSource
		const adapter =
			typeof sourceId === 'string' ? args.adapters.find((a) => a.id === sourceId) : undefined
		if (!adapter) {
			return opts
		}
		return opts.filter((o) => typeof o === 'object' && supports(adapter, o.value as MetricKey))
	}
	return {
		name: 'metric',
		type: 'select',
		required: true,
		...(defaultValue !== undefined ? { defaultValue } : {}),
		label: labelForKey(keys.widgetFieldMetric),
		options,
		...(args.multiProvider ? { filterOptions } : {}),
	}
}

const titleField = (args: RegisterWidgetsArgs, placeholder: string): Field => ({
	name: 'title',
	type: 'text',
	label: labelForKey(keys.widgetFieldTitle),
	...(args.localizeText ? { localized: true } : {}),
	admin: { placeholder },
})

const metricWidgetFields = (args: RegisterWidgetsArgs): Field[] => {
	const fields: Field[] = [
		titleField(args, en[keys.widgetFieldTitlePlaceholder]),
		metricSelectField(WIDGET_METRICS, args),
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
		titleField(args, en[spec.label]),
		metricSelectField(WIDGET_METRICS, args, { extra: { dimensions: [spec.dimension] } }),
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
		titleField(args, en[keys.widgetFieldTitlePlaceholder]),
		metricSelectField(['visitors', 'pageviews'], args, {
			extra: { realtime: true },
			preferredDefault: 'visitors',
		}),
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
		const fields = def.fields(args)
		// A required metric select with no servable option would make the widget
		// impossible to configure; skip it like an unsupported widget.
		const metricField = fields.find((f) => 'name' in f && f.name === 'metric')
		if (metricField && 'options' in metricField && metricField.options.length === 0) {
			continue
		}
		built.push({
			slug: def.slug,
			Component: def.component,
			label: labelForKey(def.label),
			fields,
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
