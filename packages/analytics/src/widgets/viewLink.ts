import type { PayloadRequest } from 'payload'
import { formatAdminURL } from 'payload/shared'
import type { AnalyticsFilter, DateRange, DimensionKey, MetricKey } from '../core/contract'
import { MAX_QUERY_RANGE_DAYS } from '../query/limits'
import type { TimeframePreset } from '../timeframe/presets'
import { zonedCalendarDay } from '../timeframe/tz'
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

/**
 * The view as a widget sees it: where it mounts and what it opens on, or false when the
 * app turned it off. The defaults travel with the path because a link must leave out
 * exactly what the view would have defaulted to anyway.
 */
export type WidgetView =
	| { path: string; defaultRange: TimeframePreset; defaultMetric: MetricKey }
	| false

/** What `registerWidgets` adds to every built-in widget's server props. */
export interface WidgetViewProps {
	view?: WidgetView
}

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
	 * The dimension the widget ranks, so the view opens on the same grouping rather than on
	 * whatever its tab defaults to. Dropped when it is that default, which keeps the link short
	 * and unchanged for every widget whose dimension already leads its tab.
	 */
	dim?: DimensionKey
	/** The widget's own filter, carried as the view's filter state. */
	filters?: AnalyticsFilter[]
}

/** `allTime` is no range the view can hold, so an install defaulting to it opens here. */
const fallbackRange = (defaults: ViewDefaults): TimeframePreset =>
	defaults.range === 'allTime' ? DEFAULT_VIEW_RANGE : defaults.range

const DAY_MS = 86_400_000

/**
 * The widest custom window the view will accept, as a start day. `parseViewState` drops a
 * wider one and opens on the default range instead, silently, so a widget on a longer
 * window links to the last `MAX_QUERY_RANGE_DAYS` days of it: the most of what the widget
 * shows that the view can show back.
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
 * The widget's window as the view's toolbar can hold it. A preset the toolbar does not
 * offer (`allTime`, `thisMonth`, `thisYear`) would select nothing there, so the link drops
 * the range instead and the view opens on its own default.
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
 * A relative admin link opening the analytics view on what the widget shows. Nothing is
 * coerced against the source's capabilities here: the view does that on open, so a link
 * naming something the selected source cannot serve still lands on a working view.
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
 * The same link for a built-in widget, or nothing at all when the view is off. Omitting
 * `timeframe` opens the view on its configured range, for a widget (realtime) whose own
 * rolling window is no range the view can hold.
 */
export const widgetViewHref = (
	view: WidgetView | undefined,
	req: PayloadRequest,
	args: Omit<
		ViewHrefArgs,
		'adminRoute' | 'viewPath' | 'defaultRange' | 'defaultMetric' | 'timeframe'
	> & { timeframe?: TimeframePreset | 'custom' }
): string | undefined =>
	view
		? viewHref({
				...args,
				timeframe: args.timeframe ?? view.defaultRange,
				adminRoute: req.payload.config.routes.admin,
				viewPath: view.path,
				defaultRange: view.defaultRange,
				defaultMetric: view.defaultMetric,
			})
		: undefined

/** The breakdown tab that offers a dimension; every contract dimension belongs to one. */
export const viewTabForDimension = (dimension: DimensionKey): BreakdownTab | undefined =>
	BREAKDOWN_TABS.find((tab) => TAB_DIMENSIONS[tab].includes(dimension))
