import type { WidgetServerProps } from 'payload'
import { formatAdminURL } from 'payload/shared'
import type { AnalyticsFilter, DateRange, DimensionKey, MetricKey } from '../core/contract'
import type { AnalyticsCountryFlags } from '../core/options'
import { MAX_QUERY_RANGE_DAYS } from '../query/limits'
import type { TimeframePreset } from '../timeframe/presets'
import { DAY_MS, DEFAULT_TIMEZONE, zonedCalendarDay } from '../timeframe/tz'
import { keys } from '../translations/keys'
import type { Translate } from '../translations/server'
import { BREAKDOWN_TABS, type BreakdownTab, TAB_DIMENSIONS } from '../view/gating'
import {
	DEFAULT_VIEW_LIMIT,
	DEFAULT_VIEW_RANGE,
	DEFAULT_VIEW_TAB,
	serializeViewState,
	VIEW_RANGE_PRESETS,
	type ViewDefaults,
	type ViewState,
} from '../view/state'
import type { WidgetWindow } from './widgetWindow'

/**
 * The view as a widget sees it, or false when the app turned it off. Defaults travel with the
 * path because a link must leave out exactly what the view would default to.
 *
 * @beta
 */
export type WidgetView =
	| { path: string; defaultRange: TimeframePreset; defaultMetric: MetricKey }
	| false

/**
 * What the plugin adds to every built-in widget's server props, and to a widget override's: a
 * server component in a widget's place receives them beside Payload's own widget props.
 *
 * @beta
 */
export interface WidgetViewProps {
	view?: WidgetView
	/**
	 * The install's `countryFlags`, which a widget draws whether or not the view is on: the host's
	 * component, when it set one, is rendered once per row.
	 */
	countryFlags?: boolean | AnalyticsCountryFlags
}

/**
 * What a built-in widget is rendered with: Payload's widget props and the plugin's own.
 *
 * @beta
 */
export type AnalyticsWidgetProps = WidgetServerProps & WidgetViewProps

export interface ViewHrefArgs {
	adminRoute: string
	viewPath: string
	/** The install's own starting point, so the link omits what the view defaults to. */
	defaultRange: TimeframePreset
	defaultMetric: MetricKey
	source?: string
	timeframe: TimeframePreset | 'custom'
	/** The widget's own window, needed only for a custom timeframe. */
	range?: DateRange
	timezone: string
	compare?: boolean
	metric?: MetricKey
	tab?: BreakdownTab
	/**
	 * Dimension the widget ranks, so the view opens on the same grouping. Dropped when it is the
	 * tab's default, which keeps the link short.
	 */
	dim?: DimensionKey
	/** The widget's own filter, carried as the view's filter state. */
	filters?: AnalyticsFilter[]
}

/** `allTime` is no range the view can hold, so an install defaulting to it opens here. */
const fallbackRange = (defaults: ViewDefaults): TimeframePreset =>
	defaults.range === 'allTime' ? DEFAULT_VIEW_RANGE : defaults.range

/**
 * Start day of the widest window the view accepts: `parseViewState` silently drops a wider one,
 * so a longer widget window links to its last `MAX_QUERY_RANGE_DAYS` days.
 */
const clampStartDay = (from: string, to: string): string => {
	const start = Date.parse(`${from}T00:00:00.000Z`)
	const end = Date.parse(`${to}T00:00:00.000Z`)
	if (Number.isNaN(start) || Number.isNaN(end)) {
		return from
	}
	// Both days are read whole, so the cap counts them inclusively.
	const earliest = end - (MAX_QUERY_RANGE_DAYS - 1) * DAY_MS
	return start < earliest ? new Date(earliest).toISOString().slice(0, 10) : from
}

/**
 * The widget's window as the view's toolbar can hold it. A preset the toolbar lacks (`allTime`,
 * `thisMonth`, `thisYear`) would select nothing, so the link drops it for the view's default.
 */
const rangeOf = (
	args: ViewHrefArgs,
	defaults: ViewDefaults
): Pick<ViewState, 'range' | 'from' | 'to'> => {
	if (args.timeframe === 'custom') {
		if (!args.range) {
			return { range: fallbackRange(defaults) }
		}
		const to = zonedCalendarDay(args.range.end, args.timezone)
		return {
			range: 'custom',
			from: clampStartDay(zonedCalendarDay(args.range.start, args.timezone), to),
			to,
		}
	}
	return VIEW_RANGE_PRESETS.includes(args.timeframe)
		? { range: args.timeframe }
		: { range: fallbackRange(defaults) }
}

/**
 * Relative admin link opening the view on what the widget shows. Capabilities go unchecked: the
 * view coerces on open, so a link it cannot serve still lands on a working view.
 */
export const viewHref = (args: ViewHrefArgs): string => {
	const defaults: ViewDefaults = { range: args.defaultRange, metric: args.defaultMetric }
	const tab = args.tab ?? DEFAULT_VIEW_TAB
	// Against the declared order, not the source's: a link is built without capabilities, and a
	// `dim` naming what the selected source leads its tab with is dropped by the view anyway.
	const dim = args.dim === TAB_DIMENSIONS[tab][0] ? undefined : args.dim
	const state: ViewState = {
		...rangeOf(args, defaults),
		compare: args.compare === true,
		...(args.source === undefined ? {} : { source: args.source }),
		metric: args.metric ?? defaults.metric,
		tab,
		...(dim === undefined ? {} : { dim }),
		filters: args.filters ?? [],
		limit: DEFAULT_VIEW_LIMIT,
	}
	// `resolveView` refuses a path without a leading slash, so the option cannot be wider.
	const path = formatAdminURL({
		adminRoute: args.adminRoute,
		path: args.viewPath as `/${string}`,
	})
	const query = serializeViewState(state, defaults).toString()
	return query ? `${path}?${query}` : path
}

/**
 * A built-in card's footer link into the view, opened on what the card shows; no `href` when the
 * view is off. Without a `window` it opens on the view's configured range, as a rolling window
 * (realtime) is none the view can hold.
 */
export const widgetLink = (
	props: Pick<AnalyticsWidgetProps, 'view' | 'req'>,
	t: Translate,
	{
		window,
		adapterId,
		...args
	}: Pick<ViewHrefArgs, 'compare' | 'metric' | 'tab' | 'dim' | 'filters'> & {
		window?: WidgetWindow
		/**
		 * The adapter that answered, which on a scoped or runtime-provider install is not always
		 * the one the widget asked for.
		 */
		adapterId: string
	}
): { href?: string; label: string } => {
	const view = props.view
	const label = t(keys.widgetOpenInView)
	if (!view) {
		return { label }
	}
	const href = viewHref({
		...args,
		adminRoute: props.req.payload.config.routes.admin,
		viewPath: view.path,
		defaultRange: view.defaultRange,
		defaultMetric: view.defaultMetric,
		timeframe: window?.saved ?? view.defaultRange,
		timezone: window?.timezone ?? DEFAULT_TIMEZONE,
		...(window?.range ? { range: window.range } : {}),
		...(adapterId ? { source: adapterId } : {}),
	})
	return { href, label }
}

/** The breakdown tab that offers a dimension; every contract dimension belongs to one. */
export const viewTabForDimension = (dimension: DimensionKey): BreakdownTab | undefined =>
	BREAKDOWN_TABS.find((tab) => TAB_DIMENSIONS[tab].includes(dimension))
