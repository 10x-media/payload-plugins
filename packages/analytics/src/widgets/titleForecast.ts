import type { PayloadRequest } from 'payload'
import { unitForRange } from '../charts/bucket'
import { currentDate } from '../core/clock'
import type { AnalyticsAdapter, MetricKey } from '../core/contract'
import { getRuntime } from '../plugin/runtime'
import { resolveTimeframe, type TimeframePreset } from '../timeframe/presets'
import { DAY_MS } from '../timeframe/tz'
import { metricLabelKey } from '../translations/metricKeys'
import { asTranslate, type Translate } from '../translations/server'
import { resolveCustomRange } from './range'
import type { MetricWidgetData, WidgetRange } from './types'

/**
 * What a widget's read will call its visitors before it runs: `summed` for daily visitors added
 * up over several days, `plain` for people counted once, `unknown` where only the read can say.
 */
export type TitleForecast = 'plain' | 'summed' | 'unknown'

/**
 * Whether the window holds one day or several, read without the reporting zone, so unknown near
 * a month's or year's turn: those windows hold one day on their first, which zones disagree on.
 */
const dayCount = (
	timeframe: TimeframePreset | 'custom',
	range: WidgetRange | undefined,
	now: Date
): 'one' | 'several' | 'unknown' => {
	if (timeframe === 'today') {
		return 'one'
	}
	if (timeframe === 'custom') {
		const picked = resolveCustomRange(timeframe, range, 'UTC')
		return picked && picked.end.getTime() - picked.start.getTime() < DAY_MS ? 'one' : 'several'
	}
	if (timeframe !== 'thisMonth' && timeframe !== 'thisYear') {
		return 'several'
	}
	const near = [-DAY_MS, 0, DAY_MS].map((offset) => new Date(now.getTime() + offset))
	const firstDay = (at: Date): boolean =>
		at.getUTCDate() === 1 && (timeframe === 'thisMonth' || at.getUTCMonth() === 0)
	return near.some(firstDay) ? 'unknown' : 'several'
}

/**
 * The source a widget will read through, when config alone names it: the one it picked, or the
 * install's default where no scope can bring sources of its own. Undefined otherwise.
 */
const knownSource = (
	req: PayloadRequest,
	dataSource: string | undefined
): AnalyticsAdapter | undefined => {
	const runtime = getRuntime(req.payload)
	if (!runtime) {
		return undefined
	}
	if (dataSource !== undefined) {
		return runtime.configAdapterIds.has(dataSource)
			? runtime.registry.all().find((adapter) => adapter.id === dataSource)
			: undefined
	}
	if (runtime.resolveRegistry) {
		return undefined
	}
	// A tenant never sees a shared source that cannot narrow to it, so it reads another one.
	const fallback = runtime.registry.default()
	return runtime.scoped === true && fallback.capabilities.scopedQueries !== true
		? undefined
		: fallback
}

/** Whether the engine folds the source's days into the weeks or months a trend reads. */
const foldsDays = (
	source: AnalyticsAdapter,
	args: { timeframe: TimeframePreset | 'custom'; range?: WidgetRange; now: Date }
): boolean => {
	if (source.capabilities.calendarBuckets === true) {
		return false
	}
	const window =
		resolveCustomRange(args.timeframe, args.range, 'UTC') ??
		resolveTimeframe(args.timeframe === 'custom' ? 'last30days' : args.timeframe, args.now)
	const unit = unitForRange(window)
	return unit === 'week' || unit === 'month'
}

/**
 * Forecasts from config alone whether a visitors read will be `visitorsSummed`, so the card's
 * loading frame carries the title the finished card will have.
 */
export const forecastVisitorsTitle = (args: {
	req: PayloadRequest
	metric: MetricKey
	dataSource?: string
	timeframe: TimeframePreset | 'custom'
	range?: WidgetRange
	now: Date
	/** The read is a trend series, bucketed to suit its window. */
	series?: boolean
}): TitleForecast => {
	if (args.metric !== 'visitors') {
		return 'plain'
	}
	const days = dayCount(args.timeframe, args.range, args.now)
	if (days === 'one') {
		return 'plain'
	}
	const source = knownSource(args.req, args.dataSource)
	if (source === undefined) {
		return 'unknown'
	}
	const daily = source.capabilities.semantics?.visitors === 'sumOfDaily'
	if (!daily && !(args.series === true && foldsDays(source, args))) {
		return 'plain'
	}
	return days === 'unknown' ? 'unknown' : 'summed'
}

/** A metric or trend card's title: its own, else its metric's name as the read counted it. */
export const metricWidgetTitle = (
	data: MetricWidgetData,
	t: Translate,
	visitorsSummed?: boolean
): string => data.title?.trim() || t(metricLabelKey(data.metric ?? 'pageviews', visitorsSummed))

/**
 * A metric or trend card's title while its read runs, forecast from config alone and pending
 * where only the read can say.
 */
export const placeholderTitle = (
	req: PayloadRequest,
	data: MetricWidgetData,
	options: { series: boolean }
): { title: string; titlePending: boolean } => {
	const t = asTranslate(req.i18n.t)
	if (data.title?.trim()) {
		return { title: metricWidgetTitle(data, t), titlePending: false }
	}
	const forecast = forecastVisitorsTitle({
		req,
		metric: data.metric ?? 'pageviews',
		dataSource: data.dataSource,
		timeframe: data.timeframe ?? 'last30days',
		range: data.range,
		now: currentDate(),
		series: options.series,
	})
	return {
		title: metricWidgetTitle(data, t, forecast === 'summed'),
		titlePending: forecast === 'unknown',
	}
}
