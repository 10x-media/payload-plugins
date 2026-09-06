import type {
	Config,
	Field,
	SelectField,
	SelectFieldSingleValidation,
	Widget,
	WidgetWidth,
} from 'payload'
import { type CapabilityRequirement, satisfiesCapabilities } from '../core/capabilities'
import type { AnalyticsAdapter, MetricKey } from '../core/contract'
import { dateRangeField } from '../fields/dateRange/field'
import { TIMEFRAME_PRESETS } from '../timeframe/presets'
import { de } from '../translations/de'
import { en } from '../translations/en'
import type { TranslationKey } from '../translations/keys'
import { keys } from '../translations/keys'
import { METRIC_KEYS, TIMEFRAME_KEYS } from '../translations/metricKeys'
import { labelForKey } from '../translations/server'
import { BREAKDOWN_SPECS, type BreakdownSpec } from './breakdownTypes'
import { buildCustomWidgets, type CustomWidgetDef } from './customWidget'
import { WIDGET_METRICS } from './types'

/**
 * Select options must carry static labels: `filterOptions` results are serialized
 * into client form state at request time, where a label function cannot cross the
 * server/client boundary.
 */
const staticLabel = (key: TranslationKey): Record<string, string> => ({
	de: de[key],
	en: en[key],
})

export interface RegisterWidgetsArgs {
	adapters: AnalyticsAdapter[]
	multiProvider: boolean
	/**
	 * True when a tenant's own runtime adapter can exist (`providers.collection` or
	 * `providers.resolve`). Such an adapter's capabilities are unknown at config time, so
	 * gating on the config-adapter union would impose a false ceiling: widgets and metric
	 * options open up, and the per-request sources endpoint plus client pickers narrow per
	 * request instead.
	 */
	providersEnabled: boolean
	disabled: string[]
	register: CustomWidgetDef[]
	localizeText?: boolean
	/** The plugin's configured defaultAdapter, when set; falls back to the first adapter. */
	defaultId?: string
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
 * {@link registerWidgets} treats as "skip this widget". When `providersEnabled`, the
 * config-adapter filter is skipped entirely: a tenant's own runtime adapter may serve
 * metrics no config adapter does, so every candidate is offered and `filterOptions` alone
 * narrows once a `dataSource` is picked.
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
	const options = (
		args.providersEnabled
			? candidates
			: candidates.filter((m) => args.adapters.some((a) => supports(a, m)))
	).map((m) => ({ value: m, label: staticLabel(METRIC_KEYS[m]) }))
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
		admin: {
			// A required metric has no meaningful cleared state.
			isClearable: false,
			components: {
				Field: {
					path: '@10x-media/analytics/client#MetricSelectField',
					...(extra ? { clientProps: { requires: extra } } : {}),
				},
			},
		},
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

const timeframeSelectField = (): Field => ({
	name: 'timeframe',
	type: 'select',
	required: true,
	defaultValue: 'last30days',
	label: labelForKey(keys.widgetFieldTimeframe),
	admin: { isClearable: false },
	options: [
		...TIMEFRAME_PRESETS.map((p) => ({ value: p, label: labelForKey(TIMEFRAME_KEYS[p]) })),
		{ value: 'custom', label: labelForKey(keys.widgetTimeframeCustom) },
	],
})

const dataSourceField = (args: RegisterWidgetsArgs): Field => ({
	name: 'dataSource',
	type: 'select',
	label: labelForKey(keys.widgetFieldDataSource),
	defaultValue: args.defaultId ?? args.adapters[0]?.id,
	admin: {
		// Clearing would leave no source; the widget always reads through one.
		isClearable: false,
		components: { Field: { path: '@10x-media/analytics/client#SourceSelectField' } },
	},
	options: args.adapters.map((a) => ({ value: a.id, label: a.label })),
	// Payload's select validator rejects any value absent from `options`, but runtime
	// (DB-registered) provider ids are only known per request, not at config time.
	validate: ((value) =>
		value === undefined || value === null || (typeof value === 'string' && value.length > 0)
			? true
			: 'invalid data source') as SelectFieldSingleValidation,
})

const customRangeField = (): Field =>
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
	})

/** The metric select in a widget's field list. */
export const findMetricField = (fields: Field[]): Field | undefined =>
	fields.find((field) => 'name' in field && field.name === 'metric')

const metricWidgetFields = (args: RegisterWidgetsArgs): Field[] => [
	titleField(args, en[keys.widgetFieldTitlePlaceholder]),
	metricSelectField(WIDGET_METRICS, args),
	timeframeSelectField(),
	customRangeField(),
	...(args.multiProvider ? [dataSourceField(args)] : []),
]

const breakdownWidgetFields = (args: RegisterWidgetsArgs, spec: BreakdownSpec): Field[] => [
	titleField(args, en[spec.label]),
	metricSelectField(WIDGET_METRICS, args, { extra: { dimensions: [spec.dimension] } }),
	timeframeSelectField(),
	customRangeField(),
	{
		name: 'limit',
		type: 'number',
		defaultValue: 5,
		min: 1,
		max: 20,
		label: labelForKey(keys.widgetFieldLimit),
	},
	...(args.multiProvider ? [dataSourceField(args)] : []),
]

const realtimeWidgetFields = (args: RegisterWidgetsArgs): Field[] => [
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
		admin: { isClearable: false },
		options: [
			{ value: '5', label: '5 min' },
			{ value: '15', label: '15 min' },
			{ value: '30', label: '30 min' },
			{ value: '60', label: '60 min' },
		],
	},
	...(args.multiProvider ? [dataSourceField(args)] : []),
]

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
		if (!args.providersEnabled && !widgetIsSupported(def.requires, args.adapters)) {
			continue
		}
		const fields = def.fields(args)
		// A required metric select with no servable option would make the widget
		// impossible to configure; skip it like an unsupported widget.
		const metricField = findMetricField(fields)
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
