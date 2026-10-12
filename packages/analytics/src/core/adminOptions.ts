import type { WidgetWidth } from 'payload'
import { TIMEFRAME_PRESETS } from '../timeframe/presets'
import { METRIC_KEYS } from '../translations/metricKeys'
import type { CustomWidgetDef } from '../widgets/customWidget'
import { assertRequirementKeys } from './capabilities'
import { keysOf, optionalBoolean, optionalList, optionsObject } from './optionChecks'
import type {
	AnalyticsComponent,
	AnalyticsCountryFlags,
	AnalyticsPluginOptions,
	AnalyticsViewOptions,
	AnalyticsWidgetOverride,
	AnalyticsWidgetOverrides,
	AnalyticsWidgetsOptions,
	ResolvedOptions,
	ResolvedView,
} from './options'
import { isRecord, kindOf, listOf, onlyKeys } from './values'
import { BUILT_IN_WIDGET_SLUGS, isBuiltInWidgetSlug } from './widgetSlugs'

const VIEW_KEYS = keysOf<AnalyticsViewOptions>({
	path: true,
	defaultRange: true,
	defaultMetric: true,
	navLabel: true,
	Component: true,
})
const WIDGETS_KEYS = keysOf<AnalyticsWidgetsOptions>({
	disabled: true,
	register: true,
	localizeText: true,
	comparison: true,
	overrides: true,
})
const WIDGET_DEF_KEYS = keysOf<CustomWidgetDef>({
	slug: true,
	component: true,
	label: true,
	fields: true,
	requires: true,
	minWidth: true,
	maxWidth: true,
})
const WIDGET_WIDTHS = keysOf<Record<WidgetWidth, true>>({
	'x-small': true,
	small: true,
	medium: true,
	large: true,
	'x-large': true,
	full: true,
})

export const DEFAULT_VIEW: ResolvedView = {
	path: '/analytics',
	defaultRange: 'last30days',
	defaultMetric: 'pageviews',
}

/** A label as Payload takes one without a function: a string, or a map of strings by language. */
const isStaticLabel = (value: unknown): boolean =>
	typeof value === 'string' ||
	(isRecord(value) && Object.values(value).every((text) => typeof text === 'string'))

/**
 * A component option as Payload takes one, checked at boot: a typo'd shape would otherwise
 * surface only as an empty slot once an admin page renders.
 */
const resolveComponent = (value: unknown, path: string): AnalyticsComponent => {
	if (typeof value === 'string' && value.trim() !== '') {
		return value
	}
	if (isRecord(value)) {
		onlyKeys(value, ['path', 'exportName', 'clientProps', 'serverProps'], path)
		const { exportName, clientProps, serverProps } = value
		if (
			typeof value.path === 'string' &&
			value.path.trim() !== '' &&
			(exportName === undefined || typeof exportName === 'string') &&
			(clientProps === undefined || isRecord(clientProps)) &&
			(serverProps === undefined || isRecord(serverProps))
		) {
			return {
				path: value.path,
				...(exportName === undefined ? {} : { exportName }),
				...(clientProps === undefined ? {} : { clientProps }),
				...(serverProps === undefined ? {} : { serverProps }),
			}
		}
	}
	throw new Error(
		`analytics: ${path} must be a component path such as '/components/Flag#Flag', or { path, exportName?, clientProps?, serverProps? }, got ${kindOf(value)}`
	)
}

/** `view`: off with `false`, else its path, opening range and metric, nav label and component. */
export const resolveView = (option: AnalyticsPluginOptions['view']): false | ResolvedView => {
	if (option === false) {
		return false
	}
	if (option !== undefined) {
		optionsObject(option, {
			path: 'view',
			known: VIEW_KEYS,
			example: "false, or an object such as { path: '/analytics' }",
		})
		const navLabel: unknown = option.navLabel
		if (navLabel !== undefined && (!isStaticLabel(navLabel) || Array.isArray(navLabel))) {
			throw new Error(
				`analytics: view.navLabel must be a label, or a map of labels by language such as { en: 'Stats' }, got ${kindOf(navLabel)}`
			)
		}
	}
	const path = option?.path ?? DEFAULT_VIEW.path
	if (typeof path !== 'string' || !path.startsWith('/')) {
		throw new Error(`analytics: view.path must start with "/", got "${String(path)}"`)
	}
	const defaultRange = option?.defaultRange ?? DEFAULT_VIEW.defaultRange
	if (!TIMEFRAME_PRESETS.includes(defaultRange)) {
		throw new Error(`analytics: unknown view.defaultRange "${String(defaultRange)}"`)
	}
	const defaultMetric = option?.defaultMetric ?? DEFAULT_VIEW.defaultMetric
	if (!(defaultMetric in METRIC_KEYS)) {
		throw new Error(`analytics: unknown view.defaultMetric "${String(defaultMetric)}"`)
	}
	return {
		path,
		defaultRange,
		defaultMetric,
		...(option?.navLabel !== undefined ? { navLabel: option.navLabel } : {}),
		...(option?.Component !== undefined
			? { Component: resolveComponent(option.Component, 'view.Component') }
			: {}),
	}
}

/** `countryFlags`: a switch, or the host's own flag component. */
export const resolveCountryFlags = (
	option: AnalyticsPluginOptions['countryFlags']
): boolean | AnalyticsCountryFlags => {
	if (option === undefined || typeof option === 'boolean') {
		return option ?? true
	}
	if (!isRecord(option)) {
		throw new Error(
			`analytics: countryFlags must be a boolean or { Component }, got ${kindOf(option)}`
		)
	}
	onlyKeys(option, ['Component'], 'countryFlags')
	return { Component: resolveComponent(option.Component, 'countryFlags.Component') }
}

/** `widgets.overrides`, each entry naming a built-in widget and holding only what can change. */
const resolveWidgetOverrides = (
	overrides: AnalyticsWidgetOverrides | undefined
): AnalyticsWidgetOverrides => {
	if (overrides === undefined) {
		return {}
	}
	if (!isRecord(overrides)) {
		throw new Error(
			`analytics: widgets.overrides must be an object keyed by widget slug, got ${kindOf(overrides)}`
		)
	}
	const out: AnalyticsWidgetOverrides = {}
	for (const [slug, override] of Object.entries(overrides)) {
		if (!isBuiltInWidgetSlug(slug)) {
			throw new Error(
				`analytics: widgets.overrides names "${slug}", which is no built-in widget. The built-in ones are ${listOf(BUILT_IN_WIDGET_SLUGS)}; a widget of your own goes in widgets.register`
			)
		}
		if (override === undefined) {
			continue
		}
		const path = `widgets.overrides.${slug}`
		if (!isRecord(override)) {
			throw new Error(`analytics: ${path} must be an object, got ${kindOf(override)}`)
		}
		onlyKeys(override, ['Component', 'label', 'fields'], path)
		const { Component, label, fields }: AnalyticsWidgetOverride = overrides[slug] ?? {}
		if (label !== undefined && typeof label !== 'function' && !isStaticLabel(label)) {
			throw new Error(
				`analytics: ${path}.label must be a string, a map of strings by language, or a label function, got ${kindOf(label)}`
			)
		}
		if (fields !== undefined && typeof fields !== 'function') {
			throw new Error(
				`analytics: ${path}.fields must be a function receiving { defaultFields }, the widget's own fields, got ${kindOf(fields)}`
			)
		}
		out[slug] = {
			...(Component === undefined
				? {}
				: { Component: resolveComponent(Component, `${path}.Component`) }),
			...(label === undefined ? {} : { label }),
			...(fields === undefined ? {} : { fields }),
		}
	}
	return out
}

/** One `widgets.register` entry at `at`; answers its slug. */
const assertWidgetDef = (def: unknown, at: string): string => {
	const entry = optionsObject(def, {
		path: at,
		known: WIDGET_DEF_KEYS,
		example: "a widget such as { slug: 'my-widget', component: '/widgets/My#My', label: 'Mine' }",
	})
	const { slug, component, label, requires } = entry
	if (typeof slug !== 'string' || slug.trim() === '') {
		throw new Error(`analytics: ${at}.slug must be a widget slug, got ${kindOf(slug)}`)
	}
	if (typeof component !== 'string' || component.trim() === '') {
		throw new Error(
			`analytics: ${at}.component must be a component path such as '/widgets/My#My', got ${kindOf(component)}`
		)
	}
	if (typeof label !== 'function' && !isStaticLabel(label)) {
		throw new Error(
			`analytics: ${at}.label must be a label, a map of labels by language, or a label function, got ${kindOf(label)}`
		)
	}
	optionalList(entry.fields, `${at}.fields`, "[{ name: 'title', type: 'text' }]")
	if (requires !== undefined) {
		if (!isRecord(requires) || Array.isArray(requires)) {
			throw new Error(
				`analytics: ${at}.requires must be a capability requirement such as { metrics: ['pageviews'] }, got ${kindOf(requires)}`
			)
		}
		assertRequirementKeys(requires, `${at}.requires`)
	}
	for (const key of ['minWidth', 'maxWidth'] as const) {
		const width = entry[key]
		if (width !== undefined && (typeof width !== 'string' || !WIDGET_WIDTHS.includes(width))) {
			throw new Error(
				`analytics: ${at}.${key} must be one of ${listOf(WIDGET_WIDTHS)}, got ${kindOf(width)}`
			)
		}
	}
	return slug
}

/** `widgets` in its object form: its switches, the widgets it adds, and the ones it leaves out. */
const assertWidgetsShape = (option: AnalyticsWidgetsOptions): void => {
	const shaped = optionsObject(option, {
		path: 'widgets',
		known: WIDGETS_KEYS,
		example: 'true, false or an object such as { disabled: [] }',
	})
	optionalBoolean(shaped.localizeText, 'widgets.localizeText')
	optionalBoolean(shaped.comparison, 'widgets.comparison')
	const defs = optionalList(
		shaped.register,
		'widgets.register',
		"[{ slug: 'my-widget', component: '/widgets/My#My', label: 'Mine' }]"
	)
	const registered = new Set(
		defs.map((def, index) => assertWidgetDef(def, `widgets.register[${index}]`))
	)
	for (const slug of optionalList(shaped.disabled, 'widgets.disabled', "['analytics-realtime']")) {
		if (typeof slug !== 'string' || (!isBuiltInWidgetSlug(slug) && !registered.has(slug))) {
			throw new Error(
				`analytics: widgets.disabled names ${kindOf(slug)}, which is no widget of this install. The built-in ones are ${listOf(BUILT_IN_WIDGET_SLUGS)}; a widget of your own is named by its widgets.register slug`
			)
		}
	}
}

/** `widgets`: on by default, off with `false`, or an object of switches, additions, overrides. */
export const resolveWidgets = (
	option: AnalyticsPluginOptions['widgets']
): ResolvedOptions['widgets'] => {
	const defaults = {
		disabled: [],
		register: [],
		localizeText: false,
		comparison: true,
		overrides: {},
	}
	if (option === false) {
		return { enabled: false, ...defaults }
	}
	if (option === undefined || option === true) {
		return { enabled: true, ...defaults }
	}
	assertWidgetsShape(option)
	return {
		enabled: true,
		disabled: option.disabled ?? [],
		register: option.register ?? [],
		localizeText: option.localizeText ?? false,
		comparison: option.comparison ?? true,
		overrides: resolveWidgetOverrides(option.overrides),
	}
}
