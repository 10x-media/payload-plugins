import type { PayloadRequest } from 'payload'
import { type ReadPrincipal, readPrincipalOf } from '../access/principal'
import {
	alignSeries,
	fillSeries,
	type SeriesGranularity,
	type SeriesPoint,
	seriesGranularityFor,
} from '../charts/series'
import type {
	AnalyticsFilter,
	AnalyticsResult,
	DateRange,
	MetricKey,
	MetricValue,
} from '../core/contract'
import { emptyReading } from '../core/metricValues'
import { readFailureOf } from '../surfacing/classifyError'
import type { TimeframePreset } from '../timeframe/presets'
import {
	comparisonWindow,
	engineRead,
	prepareWidgetRead,
	type StoredSourceRead,
	type SubstitutedSource,
	substitutionOf,
	type WidgetReadStatus,
} from './prepareWidgetRead'
import { type ReadNotices, readMeta } from './readMeta'

export type { SeriesGranularity, SeriesPoint } from '../charts/series'

export interface WidgetSeriesResult extends Partial<ReadNotices>, SubstitutedSource {
	status: WidgetReadStatus
	/** How long until a `busy` read can succeed, when the source or the plugin knows. */
	retryAfterMs?: number
	adapterId: string
	/** The scope the read narrowed to, absent for an install-wide one. */
	scope?: string
	dateRange: DateRange
	/** Reporting timezone the read resolved in; the trend axis buckets in it. */
	timezone: string
	points: SeriesPoint[]
	/**
	 * The bucket the points actually carry. A window of a day or two is charted by hour, so
	 * `day` there says the source serves no hourly rows and the series is a single point.
	 */
	seriesGranularity?: SeriesGranularity
	/** The window's headline reading; `null` for an average with no samples in it. */
	total: MetricValue
	/** The source that answered, absent on a read that never reached one. */
	provider?: string
	/** Previous-window headline total, present only when the adapter supports comparison. */
	previousTotal?: MetricValue
	/** The previous comparable window, present only when comparison ran. */
	comparisonRange?: DateRange
	/**
	 * Previous window's series at the same granularity, when `compare` ran. Zero-filled to the
	 * length of `points`, so its bucket i overlays `points[i]`.
	 */
	comparisonPoints?: SeriesPoint[]
}

/** Scoped like `ReadForWidgetArgs`: the request's own scope unless one is pinned. */
export type ReadForWidgetSeriesArgs = ReadPrincipal &
	StoredSourceRead & {
		req: PayloadRequest
		metric: MetricKey
		timeframe: TimeframePreset
		adapterId?: string
		now: Date
		range?: DateRange
		/**
		 * Reporting timezone the caller already resolved, reused rather than resolved again so
		 * a caller-supplied `range` is read in the very timezone it was interpreted in.
		 */
		timezone?: string
		filters?: AnalyticsFilter[]
		/** Also return the previous window's series, for the chart's comparison overlay. */
		compare?: boolean
	}

/**
 * Trend read: a zero-filled series plus headline total. A window of a day or two reads by hour
 * where served (a daily axis there is one point); see {@link seriesGranularityFor}.
 */
export const readForWidgetSeries = async (
	args: ReadForWidgetSeriesArgs
): Promise<WidgetSeriesResult> => {
	const { req, metric, timeframe, adapterId, now, range, filters, compare } = args

	const prepared = await prepareWidgetRead({
		req,
		now,
		timeframe,
		adapterId,
		...readPrincipalOf(args),
		...(args.fallbackWhenUnreadable ? { fallbackWhenUnreadable: true } : {}),
		timezone: args.timezone,
		range,
		filters,
		requires: { metrics: [metric] },
		granularity: 'day',
		goalRead: () => ({ metrics: [metric] }),
	})
	if (!prepared.ok) {
		return {
			status: prepared.status,
			adapterId: prepared.adapterId,
			dateRange: prepared.dateRange,
			timezone: prepared.tz,
			points: [],
			total: 0,
		}
	}
	const { adapter, tz, dateRange, goalSlugs } = prepared
	const granularity = seriesGranularityFor(dateRange, adapter.capabilities)
	const comparisonRange = comparisonWindow(prepared, now)
	const readBase = {
		metrics: [metric],
		filters,
		timezone: tz,
		scope: prepared.queryScope,
		...(goalSlugs === undefined ? {} : { goalSlugs }),
	}
	const read = engineRead(prepared, timeframe)
	const main = read({ ...readBase, dateRange, granularity })
	// The overlay needs the previous window bucketed like the primary; the delta only its total.
	// One that fails drops the overlay and the delta, never the series itself.
	const comparing = comparisonRange
		? read({
				...readBase,
				dateRange: comparisonRange,
				...(compare ? { granularity } : {}),
			}).catch(() => undefined)
		: undefined
	let result: AnalyticsResult
	try {
		result = await main
	} catch (err) {
		return {
			...readFailureOf(err),
			adapterId: adapter.id,
			dateRange,
			timezone: tz,
			points: [],
			total: 0,
		}
	}
	const previous = await comparing
	const previousTotal = previous ? previous.totals?.[metric] : undefined
	const points = fillSeries({ rows: result.rows, dateRange, metric, tz, granularity })
	const total = result.totals?.[metric]
	return {
		status: 'ok',
		adapterId: adapter.id,
		...substitutionOf(prepared),
		...(prepared.queryScope === undefined ? {} : { scope: prepared.queryScope }),
		dateRange,
		timezone: tz,
		points,
		seriesGranularity: granularity,
		total: total === undefined ? emptyReading(metric) : total,
		...readMeta(result),
		previousTotal,
		comparisonRange: previous ? comparisonRange : undefined,
		...(compare && previous && comparisonRange
			? {
					comparisonPoints: alignSeries(
						fillSeries({
							rows: previous.rows,
							dateRange: comparisonRange,
							metric,
							tz,
							granularity,
						}),
						points,
						metric
					),
				}
			: {}),
	}
}
