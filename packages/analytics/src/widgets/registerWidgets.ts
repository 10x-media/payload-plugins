import type {
	Config,
	Field,
	PayloadComponent,
	SelectField,
	SelectFieldSingleValidation,
	Widget,
	WidgetWidth,
} from 'payload'
import { type CapabilityRequirement, satisfiesCapabilities } from '../core/capabilities'
import type { AnalyticsAdapter, MetricKey } from '../core/contract'
import { isMetricKey } from '../core/guards'
import type {
	AnalyticsComponent,
	AnalyticsCountryFlags,
	AnalyticsWidgetOverride,
	AnalyticsWidgetOverrides,
} from '../core/options'
import { isRecord } from '../core/values'
import type { BuiltInWidgetSlug } from '../core/widgetSlugs'
import { dateRangeField } from '../fields/dateRange/field'
import { TIMEFRAME_PRESETS } from '../timeframe/presets'
import { numberFormat } from '../translations/intl'
import { keys, type SingularKey } from '../translations/keys'
import { METRIC_KEYS, TIMEFRAME_KEYS } from '../translations/metricKeys'
import { labelForKey } from '../translations/server'
import { builtInStaticLabel, type StaticLabelFor } from '../translations/staticLabel'
import { withoutVisitsAlias } from '../view/metricAliases'
import { BREAKDOWN_SPECS, type BreakdownSpec } from './breakdownTypes'
import { buildCustomWidgets, type CustomWidgetDef, widgetIsSupported } from './customWidget'
import { fieldByName, HALF, THIRD, TWO_THIRDS } from './fieldRows'
import { filterField } from './filterField'
import { GOAL_ROW_LIMITS, WIDGET_METRICS } from './types'
import type { WidgetView, WidgetViewProps } from './viewLink'

export interface RegisterWidgetsArgs {
	adapters: AnalyticsAdapter[]
	multiProvider: boolean
	/**
	 * A tenant's runtime adapter can exist (`providers.collection` or `providers.resolve`). Its
	 * capabilities are unknown at config time, so widgets open up and pickers narrow per request.
	 */
	providersEnabled: boolean
	/**
	 * Whether the install measures money (default on). False drops `revenue` from every metric
	 * picker, even the multi-provider one that offers the whole contract.
	 */
	revenue?: boolean
	disabled: string[]
	register: CustomWidgetDef[]
	localizeText?: boolean
	/** The plugin's configured defaultAdapter, when set; falls back to the first adapter. */
	defaultId?: string
	/** `widgets.comparison`; false hides every compare checkbox. Defaults to on. */
	comparison?: boolean
	/**
	 * Where the analytics view mounts, so every built-in widget can link into it. False or
	 * absent means no view to link to, and the widgets render without the footer link.
	 */
	view?: WidgetView
	/** The install's `countryFlags`; false drops the flag beside a country name. */
	countryFlags?: boolean | AnalyticsCountryFlags
	/**
	 * Install's static labels. Select options need them: `filterOptions` results are serialized
	 * into client form state, where a label function cannot cross. Built-ins when absent.
	 */
	staticLabel?: StaticLabelFor
	/** `widgets.overrides`: a built-in widget's component, name or settings, by slug. */
	overrides?: AnalyticsWidgetOverrides
}

interface WidgetDef {
	slug: BuiltInWidgetSlug
	component: string
	label: SingularKey
	requires?: CapabilityRequirement
	minWidth?: WidgetWidth
	maxWidth?: WidgetWidth
	fields: (args: RegisterWidgetsArgs) => Field[]
}

/**
 * Metric select offering what some configured adapter serves (every candidate when
 * `providersEnabled`), narrowed per picked source. With no options the widget is skipped.
 */
const metricSelectField = (
	candidates: MetricKey[],
	args: RegisterWidgetsArgs,
	opts: {
		extra?: Omit<CapabilityRequirement, 'metrics'>
		preferredDefault?: MetricKey
		width?: string
	} = {}
): Field => {
	const { extra, preferredDefault = 'pageviews', width } = opts
	const supports = (adapter: AnalyticsAdapter, metric: MetricKey): boolean =>
		satisfiesCapabilities(adapter.capabilities, { ...extra, metrics: [metric] })
	// Money first, then capabilities: an install that measures none reports no revenue, which
	// the multi-provider branch below would otherwise offer on the strength of the contract.
	const offered = args.revenue === false ? candidates.filter((m) => m !== 'revenue') : candidates
	const staticLabel = args.staticLabel ?? builtInStaticLabel
	const options = (
		args.providersEnabled
			? offered
			: offered.filter((m) => args.adapters.some((a) => supports(a, m)))
	).map((m) => ({ value: m, label: staticLabel(METRIC_KEYS[m]) }))
	const preferred = withoutVisitsAlias(options.map((o) => o.value))
	const defaultValue = preferred.includes(preferredDefault) ? preferredDefault : preferred[0]
	const filterOptions: SelectField['filterOptions'] = ({ options: opts, siblingData }) => {
		const sibling = isRecord(siblingData) ? siblingData : undefined
		const sourceId = sibling?.dataSource
		const adapter =
			args.multiProvider && typeof sourceId === 'string'
				? args.adapters.find((a) => a.id === sourceId)
				: undefined
		const optionValue = (option: (typeof opts)[number]): string =>
			typeof option === 'object' ? option.value : option
		const served = adapter
			? opts.filter((option) => {
					const value = optionValue(option)
					return isMetricKey(value) && supports(adapter, value)
				})
			: opts
		// `visits` stays offered only to a widget that already reads it: the admin names both
		// counts alike, so a picker holding both would list one count twice.
		const shown = withoutVisitsAlias(served.map(optionValue).filter(isMetricKey))
		return served.filter(
			(option) =>
				optionValue(option) !== 'visits' || shown.includes('visits') || sibling?.metric === 'visits'
		)
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
					path: '@10x-media/analytics/rsc#MetricSelectFieldServer',
					...(extra ? { clientProps: { requires: extra } } : {}),
				},
			},
			...(width ? { width } : {}),
		},
		filterOptions,
	}
}

type RowEntry = [make: (width?: string) => Field, width: string]

/**
 * One `row` of fields, or the bare field when the install left only one: a row holding a single
 * half-width field reads as a mistake.
 */
const rowOf = (entries: Array<RowEntry | null>): Field[] => {
	const present = entries.filter((entry): entry is RowEntry => entry !== null)
	const only = present[0]
	if (only === undefined) {
		return []
	}
	if (present.length === 1) {
		return [only[0]()]
	}
	return [{ type: 'row', fields: present.map(([make, width]) => make(width)) }]
}

/** Its placeholder is a locale map: Payload reads a placeholder where no label function runs. */
const titleField = (args: RegisterWidgetsArgs, placeholder: SingularKey): Field => ({
	name: 'title',
	type: 'text',
	label: labelForKey(keys.widgetFieldTitle),
	...(args.localizeText ? { localized: true } : {}),
	admin: { placeholder: (args.staticLabel ?? builtInStaticLabel)(placeholder) },
})

const timeframeSelectField = (width?: string): Field => ({
	name: 'timeframe',
	type: 'select',
	required: true,
	defaultValue: 'last30days',
	label: labelForKey(keys.widgetFieldTimeframe),
	admin: { isClearable: false, ...(width ? { width } : {}) },
	options: [
		...TIMEFRAME_PRESETS.map((p) => ({ value: p, label: labelForKey(TIMEFRAME_KEYS[p]) })),
		{ value: 'custom', label: labelForKey(keys.widgetTimeframeCustom) },
	],
})

/** Reads the previous period too: the trend overlays it, the goals table deltas against it. */
const compareField = (width?: string): Field => ({
	name: 'compare',
	type: 'checkbox',
	defaultValue: false,
	label: labelForKey(keys.widgetFieldCompare),
	admin: { style: { alignSelf: 'flex-end' }, ...(width ? { width } : {}) },
})

/**
 * Payload's select validator rejects any value absent from `options`, but runtime (DB-registered)
 * provider ids are only known per request, not at config time.
 */
const validateSourceId: SelectFieldSingleValidation = (value) =>
	value === undefined || value === null || (typeof value === 'string' && value.length > 0)
		? true
		: 'invalid data source'

const dataSourceField = (args: RegisterWidgetsArgs, width?: string): Field => ({
	name: 'dataSource',
	type: 'select',
	label: labelForKey(keys.widgetFieldDataSource),
	defaultValue: args.defaultId ?? args.adapters[0]?.id,
	admin: {
		// Clearing would leave no source; the widget always reads through one.
		isClearable: false,
		components: { Field: { path: '@10x-media/analytics/rsc#SourceSelectFieldServer' } },
		...(width ? { width } : {}),
	},
	options: args.adapters.map((a) => ({ value: a.id, label: a.label })),
	validate: validateSourceId,
})

/**
 * Alone on its line, never in a row: it is the form's one conditional field, and a row whose
 * other half never disappears would leave a gap wherever the condition is false.
 */
const customRangeField = (): Field =>
	dateRangeField({
		name: 'range',
		label: labelForKey(keys.widgetFieldRange),
		pickerAppearance: 'dayOnly',
		untilToday: true,
		overrides: (f) => ({
			...f,
			admin: {
				...f.admin,
				condition: (_data, siblingData) => siblingData?.timeframe === 'custom',
			},
		}),
	})

/** The metric select in a widget's field list, wherever the form's rows put it. */
export const findMetricField = (fields: Field[]): Field | undefined => fieldByName(fields, 'metric')

const breakdownLimitField = (width?: string): Field => ({
	name: 'limit',
	type: 'number',
	defaultValue: 5,
	min: 1,
	max: 20,
	label: labelForKey(keys.widgetFieldLimit),
	...(width ? { admin: { width } } : {}),
})

/** A select, not the breakdown's free number: the goals table is a summary, not a report. */
const goalLimitField = (width?: string): Field => ({
	name: 'limit',
	type: 'select',
	defaultValue: String(GOAL_ROW_LIMITS[0]),
	label: labelForKey(keys.widgetFieldLimit),
	admin: { isClearable: false, ...(width ? { width } : {}) },
	options: GOAL_ROW_LIMITS.map((limit) => ({ value: String(limit), label: String(limit) })),
})

const WINDOW_MINUTES = [5, 15, 30, 60]

const minutesFormat = (locale: string): Intl.NumberFormat =>
	numberFormat(locale, { style: 'unit', unit: 'minute', unitDisplay: 'short' })

/**
 * A number of minutes in every language the install's labels carry, as each writes it: an
 * option label is static, so it cannot be formatted for the reader when the form renders.
 */
const minutesLabel = (args: RegisterWidgetsArgs, minutes: number): Record<string, string> => {
	const locales = Object.keys((args.staticLabel ?? builtInStaticLabel)(keys.widgetFieldWindow))
	return Object.fromEntries(
		locales.map((locale) => [locale, minutesFormat(locale).format(minutes)])
	)
}

const windowMinutesField = (args: RegisterWidgetsArgs, width?: string): Field => ({
	name: 'windowMinutes',
	type: 'select',
	defaultValue: '30',
	label: labelForKey(keys.widgetFieldWindow),
	admin: { isClearable: false, ...(width ? { width } : {}) },
	options: WINDOW_MINUTES.map((minutes) => ({
		value: String(minutes),
		label: minutesLabel(args, minutes),
	})),
})

const metricRow = (args: RegisterWidgetsArgs, candidates: MetricKey[]): Field[] =>
	rowOf([
		[(width) => metricSelectField(candidates, args, { width }), HALF],
		[timeframeSelectField, HALF],
	])

const metricWidgetFields = (args: RegisterWidgetsArgs): Field[] => [
	titleField(args, keys.widgetFieldTitlePlaceholder),
	...metricRow(args, WIDGET_METRICS),
	customRangeField(),
	...(args.multiProvider ? [dataSourceField(args)] : []),
	filterField(),
]

const trendWidgetFields = (args: RegisterWidgetsArgs): Field[] => [
	titleField(args, keys.widgetFieldTitlePlaceholder),
	...metricRow(args, WIDGET_METRICS),
	customRangeField(),
	...rowOf([
		args.multiProvider ? [(width) => dataSourceField(args, width), HALF] : null,
		args.comparison === false ? null : [compareField, HALF],
	]),
	filterField(),
]

const breakdownWidgetFields = (args: RegisterWidgetsArgs, spec: BreakdownSpec): Field[] => [
	titleField(args, spec.label),
	...rowOf([
		[
			(width) =>
				metricSelectField(spec.metrics ?? WIDGET_METRICS, args, {
					extra: { dimensions: [spec.dimension] },
					preferredDefault: spec.preferredDefault,
					width,
				}),
			HALF,
		],
		[timeframeSelectField, HALF],
	]),
	customRangeField(),
	...rowOf([
		[breakdownLimitField, THIRD],
		args.multiProvider ? [(width) => dataSourceField(args, width), TWO_THIRDS] : null,
	]),
	filterField(),
]

const goalsWidgetFields = (args: RegisterWidgetsArgs): Field[] => [
	titleField(args, keys.widgetGoals),
	...rowOf([
		[timeframeSelectField, HALF],
		[goalLimitField, HALF],
	]),
	customRangeField(),
	...rowOf([
		args.comparison === false ? null : [compareField, HALF],
		args.multiProvider ? [(width) => dataSourceField(args, width), HALF] : null,
	]),
]

const realtimeWidgetFields = (args: RegisterWidgetsArgs): Field[] => [
	titleField(args, keys.widgetFieldTitlePlaceholder),
	...rowOf([
		[
			(width) =>
				metricSelectField(['visitors', 'pageviews'], args, {
					extra: { realtime: true },
					preferredDefault: 'visitors',
					width,
				}),
			HALF,
		],
		[(width) => windowMinutesField(args, width), HALF],
	]),
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
		fields: trendWidgetFields,
	},
	{
		slug: 'analytics-realtime',
		component: '@10x-media/analytics/rsc#AnalyticsRealtimeWidget',
		label: keys.widgetRealtimeLabel,
		requires: { realtime: true },
		minWidth: 'small',
		maxWidth: 'medium',
		fields: realtimeWidgetFields,
	},
	{
		slug: 'analytics-goals',
		component: '@10x-media/analytics/rsc#AnalyticsGoalsWidget',
		label: keys.widgetGoals,
		requires: { metrics: ['conversions'], dimensions: ['goal'] },
		minWidth: 'small',
		maxWidth: 'large',
		fields: goalsWidgetFields,
	},
	...BREAKDOWN_SPECS.map(
		(spec): WidgetDef => ({
			slug: spec.slug,
			component: '@10x-media/analytics/rsc#AnalyticsBreakdownWidget',
			label: spec.label,
			requires: { dimensions: [spec.dimension] },
			minWidth: 'small',
			maxWidth: 'large',
			fields: (args) => breakdownWidgetFields(args, spec),
		})
	),
]

/**
 * The widget's component: the plugin's own, or the host's in its place. Either way it keeps the
 * plugin's server props, which the host's own `serverProps` add to.
 */
const componentOf = (
	path: string,
	serverProps: WidgetViewProps,
	override: AnalyticsComponent | undefined
): PayloadComponent => {
	if (override === undefined) {
		return { path, serverProps }
	}
	if (typeof override === 'string') {
		return { path: override, serverProps }
	}
	return { ...override, serverProps: { ...serverProps, ...override.serverProps } }
}

/** A host's `fields` override, which has to hand back a list of fields. */
const overriddenFields = (
	slug: string,
	defaultFields: Field[],
	override?: AnalyticsWidgetOverride['fields']
) => {
	if (!override) {
		return defaultFields
	}
	const fields = override({ defaultFields })
	if (!Array.isArray(fields)) {
		throw new Error(
			`analytics: widgets.overrides.${slug}.fields must return an array of fields, got ${typeof fields}`
		)
	}
	return fields
}

export const registerWidgets = (config: Config, args: RegisterWidgetsArgs): void => {
	const built: Widget[] = []
	const serverProps: WidgetViewProps = {
		view: args.view ?? false,
		countryFlags: args.countryFlags ?? true,
	}
	for (const def of WIDGET_DEFS) {
		if (args.disabled.includes(def.slug)) {
			continue
		}
		if (!args.providersEnabled && !widgetIsSupported(def.requires, args.adapters)) {
			continue
		}
		const defaults = def.fields(args)
		// A required metric select with no servable option would make the widget
		// impossible to configure; skip it like an unsupported widget.
		const metricField = findMetricField(defaults)
		if (metricField && 'options' in metricField && metricField.options.length === 0) {
			continue
		}
		const override = args.overrides?.[def.slug]
		built.push({
			slug: def.slug,
			Component: componentOf(def.component, serverProps, override?.Component),
			label: override?.label ?? labelForKey(def.label),
			fields: overriddenFields(def.slug, defaults, override?.fields),
			minWidth: def.minWidth,
			maxWidth: def.maxWidth,
		})
	}
	built.push(...buildCustomWidgets(args.register, args.adapters, args.disabled))
	if (!built.length) {
		return
	}
	// New objects all the way down: the host may share its `admin` or `dashboard` across configs.
	const dashboard = config.admin?.dashboard
	config.admin = {
		...config.admin,
		dashboard: { ...dashboard, widgets: [...(dashboard?.widgets ?? []), ...built] },
	}
}
