import type { LabelFunction, StaticLabel, Tab, TabsField, UIField, UnnamedTab } from 'payload'
import type { ReportOption } from '../binding/report'
import type { DimensionKey, MetricKey } from '../core/contract'
import type { TimeframePreset } from '../timeframe/presets'
import { keys } from '../translations/keys'
import { labelForKey } from '../translations/server'
import { builtInStaticLabel } from '../translations/staticLabel'
import { PANEL_FIELD_COMPONENT, STAT_FIELD_COMPONENT } from './componentPaths'

/**
 * UI fields take static labels only, so the label is the locale map. A host builds these fields
 * before the plugin sees its options; the plugin then swaps in its install's own strings.
 */
const ANALYTICS_LABEL = builtInStaticLabel(keys.tabAnalytics)

const DEFAULT_TIMEFRAME: TimeframePreset = 'last30days'

const DEFAULT_ROW_METRICS: MetricKey[] = ['pageviews', 'visitors', 'sessions', 'avgDuration']

/**
 * Opportunistic: a source serving none shows four cards and warns nobody, so they are optional.
 * `QUIET_PANEL_METRICS` adds time on page, which no vendor but GA4 reports per pageview.
 */
const OPTIONAL_PANEL_METRICS: MetricKey[] = ['conversions', 'revenue', 'scrollDepth']
const DEFAULT_PANEL_METRICS: MetricKey[] = [...DEFAULT_ROW_METRICS, ...OPTIONAL_PANEL_METRICS]
const QUIET_PANEL_METRICS: MetricKey[] = ['avgDuration', ...OPTIONAL_PANEL_METRICS]

const DEFAULT_PANEL_DIMENSIONS: DimensionKey[] = ['country', 'source', 'device']

/** Lists the panel lays out under its trend. */
const MAX_PANEL_LISTS = 3

const panelDimensions = (option: boolean | DimensionKey[] | undefined): DimensionKey[] => {
	if (option === false) {
		return []
	}
	return Array.isArray(option) ? option.slice(0, MAX_PANEL_LISTS) : DEFAULT_PANEL_DIMENSIONS
}

const reportOf = (report: ReportOption | undefined): { report?: ReportOption } =>
	report === undefined ? {} : { report }

/**
 * A metric card label override: a plain string, a locale-to-label map, or a Payload
 * label function receiving `{ t, i18n }`. Defaults to the metric's translated name.
 */
export type AnalyticsMetricLabel = LabelFunction | StaticLabel

export type AnalyticsMetricLabels = Partial<Record<MetricKey, AnalyticsMetricLabel>>

interface StatServerProps {
	metrics: MetricKey[]
	/** The metrics are the row's defaults rather than a list the developer chose. */
	defaultMetrics?: boolean
	timeframe: TimeframePreset
	variant: 'stat' | 'row'
	adapterId?: string
	labels?: AnalyticsMetricLabels
	report?: ReportOption
}

export type AnalyticsStatBaseOptions = {
	timeframe?: TimeframePreset
	adapter?: string
	position?: 'sidebar'
	name?: string
	/**
	 * `'page'` is the document's own page, `'item'` the document as content shown on other pages;
	 * `'auto'` (default) follows the binding, the item first where bound as both.
	 */
	report?: ReportOption
}

export type AnalyticsStatOptions = AnalyticsStatBaseOptions & {
	metric: MetricKey
	/** Overrides the stat's metric card label. */
	label?: AnalyticsMetricLabel
}

export type AnalyticsStatRowOptions = AnalyticsStatBaseOptions & {
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
	/**
	 * Sources the switcher offers: `'auto'` (default) is every source of the document's scope the
	 * reader may read, a list narrows to those ids. Drawn only when more than one survives.
	 */
	sources?: 'auto' | string[]
	/** Overrides the tab label (default: the translated "Analytics"). */
	label?: UnnamedTab['label']
	description?: UnnamedTab['description']
	/** Per-metric card label overrides. */
	labels?: AnalyticsMetricLabels
	/** Interactive panel by default; `false` renders the static stats row instead. */
	interactive?: boolean
	/**
	 * Top countries, sources and devices under the trend; `false` omits them, a list picks others
	 * (at most three). Any the source cannot rank for a single page are dropped.
	 */
	breakdowns?: boolean | DimensionKey[]
	/**
	 * The live counter for this page, drawn only where the source counts live visitors.
	 * Default on; `false` leaves it out and stops the poll.
	 */
	liveVisitors?: boolean
	/**
	 * `'page'` is the document's own page, `'item'` the document as content shown elsewhere;
	 * `'auto'` (default) follows the binding, and bound as both gets a switch opening on the item.
	 */
	report?: ReportOption
}

const statField = (name: string, serverProps: StatServerProps, position?: 'sidebar'): UIField => ({
	name,
	type: 'ui',
	label: ANALYTICS_LABEL,
	admin: {
		...(position ? { position } : {}),
		// Read-only display fields have no cell value; a list column would render empty.
		disableListColumn: true,
		components: {
			Field: { path: STAT_FIELD_COMPONENT, serverProps },
		},
	},
})

export const analyticsStat = (options: AnalyticsStatOptions): UIField =>
	statField(
		options.name ?? `analytics_${options.metric}`,
		{
			metrics: [options.metric],
			timeframe: options.timeframe ?? DEFAULT_TIMEFRAME,
			variant: 'stat',
			adapterId: options.adapter,
			...(options.label ? { labels: { [options.metric]: options.label } } : {}),
			...reportOf(options.report),
		},
		options.position
	)

export const analyticsStatRow = (options: AnalyticsStatRowOptions = {}): UIField =>
	statField(
		options.name ?? 'analytics_stats',
		{
			metrics: options.metrics ?? DEFAULT_ROW_METRICS,
			...(options.metrics === undefined ? { defaultMetrics: true } : {}),
			timeframe: options.timeframe ?? DEFAULT_TIMEFRAME,
			variant: 'row',
			adapterId: options.adapter,
			labels: options.labels,
			...reportOf(options.report),
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

const panelField = (options: AnalyticsTabOptions): UIField => ({
	name: 'analytics_panel',
	type: 'ui',
	label: ANALYTICS_LABEL,
	admin: {
		disableListColumn: true,
		components: {
			Field: {
				path: PANEL_FIELD_COMPONENT,
				serverProps: {
					metrics: options.metrics ?? DEFAULT_PANEL_METRICS,
					...(options.metrics ? {} : { optionalMetrics: QUIET_PANEL_METRICS }),
					timeframe: options.timeframe ?? DEFAULT_TIMEFRAME,
					adapterId: options.adapter,
					labels: options.labels,
					dimensions: panelDimensions(options.breakdowns),
					liveVisitors: options.liveVisitors !== false,
					...(options.sources === undefined ? {} : { sources: options.sources }),
					...reportOf(options.report),
				},
			},
		},
	},
})

/**
 * Unnamed "Analytics" `Tab` for your own tabs field: the interactive panel, or the static
 * {@link analyticsStatRow} with `interactive: false`. See {@link analyticsTabsField}.
 */
export const analyticsTab = (options: AnalyticsTabOptions = {}): Tab => ({
	label: options.label ?? labelForKey(keys.tabAnalytics),
	...(options.description ? { description: options.description } : {}),
	fields: [
		options.interactive === false
			? analyticsStatRow({
					metrics: options.metrics,
					timeframe: options.timeframe,
					adapter: options.adapter,
					labels: options.labels,
					...reportOf(options.report),
				})
			: panelField(options),
	],
})

/** A ready-made tabs field containing a single {@link analyticsTab}. */
export const analyticsTabsField = (options: AnalyticsTabOptions = {}): TabsField => ({
	type: 'tabs',
	tabs: [analyticsTab(options)],
})
