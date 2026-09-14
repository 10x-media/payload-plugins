import type { WidgetServerProps } from 'payload'
import { bucketByRange, bucketSeries, onPrimaryAxis } from '../charts/bucket'
import { TrendChart } from '../charts/TrendChart'
import type { MetricKey } from '../core/contract'
import { formatMetricValue } from '../fields/format'
import { requestTimezone } from '../plugin/runtime'
import type { TimeframePreset } from '../timeframe/presets'
import { DEFAULT_TIMEZONE } from '../timeframe/tz'
import { keys, type TranslationKey } from '../translations/keys'
import { METRIC_KEYS, TIMEFRAME_KEYS } from '../translations/metricKeys'
import { asTranslate } from '../translations/server'
import { ComparisonDelta } from './ComparisonDelta'
import { cardStyle, labelStyle } from './cardChrome'
import { formatRangeCaption, resolveCustomRange } from './range'
import type { WidgetReadStatus } from './readForWidget'
import { readForWidgetSeries } from './readForWidgetSeries'
import type { MetricWidgetData } from './types'
import { type WidgetViewProps, widgetViewHref } from './viewLink'
import { WidgetViewLink } from './WidgetViewLink'

const STATE_KEY: Record<Exclude<WidgetReadStatus, 'ok'>, TranslationKey> = {
	'not-configured': keys.stateNotConfigured,
	unavailable: keys.stateUnavailable,
}

export default async function AnalyticsTrendWidget(props: WidgetServerProps & WidgetViewProps) {
	const data = (props.widgetData ?? {}) as MetricWidgetData
	const metric: MetricKey = data.metric ?? 'pageviews'
	const rawTimeframe = data.timeframe ?? 'last30days'
	// Only a custom range needs the reporting timezone before the read; a preset window
	// resolves inside the read path, which resolves the timezone there as it always has.
	const timezone = rawTimeframe === 'custom' ? await requestTimezone(props.req) : undefined
	const customRange = timezone ? resolveCustomRange(rawTimeframe, data.range, timezone) : undefined
	const timeframe: TimeframePreset = rawTimeframe === 'custom' ? 'last30days' : rawTimeframe
	const t = asTranslate(props.req.i18n.t)
	const locale = props.req.i18n.language ?? 'en-US'
	const title = data.title?.trim() || t(METRIC_KEYS[metric])

	const compare = data.compare === true
	const result = await readForWidgetSeries({
		req: props.req,
		metric,
		timeframe,
		adapterId: data.dataSource,
		now: new Date(),
		range: customRange,
		compare,
		...(timezone ? { timezone } : {}),
	})
	// The adapter that answered, which on a scoped or runtime-provider install is not the
	// id the widget asked for.
	const href = widgetViewHref(props.view, props.req, {
		timeframe: rawTimeframe,
		timezone: timezone ?? DEFAULT_TIMEZONE,
		...(customRange ? { range: customRange } : {}),
		...(result.adapterId ? { source: result.adapterId } : {}),
		metric,
		compare,
	})

	if (result.status !== 'ok') {
		return (
			<div className="analytics-trend-widget" style={cardStyle}>
				<span style={labelStyle}>{title}</span>
				<span style={{ color: 'var(--theme-elevation-400)' }}>{t(STATE_KEY[result.status])}</span>
				<WidgetViewLink href={href} label={t(keys.widgetOpenInView)} />
			</div>
		)
	}

	const caption =
		customRange && timezone
			? formatRangeCaption(customRange, locale, timezone)
			: t(TIMEFRAME_KEYS[timeframe])
	const buckets = customRange
		? bucketByRange(result.points, customRange, result.timezone)
		: bucketSeries(result.points, timeframe, result.timezone)
	const toPoints = (source: typeof buckets) =>
		source.map((b) => ({ ...b, display: formatMetricValue(metric, b.value, locale) }))
	const trendPoints = toPoints(buckets)
	// The comparison is re-dated onto the primary axis before bucketing: at week and month
	// units its own dates would fall on different boundaries.
	const previousSeries =
		compare && result.comparisonPoints
			? onPrimaryAxis(result.comparisonPoints, result.points)
			: undefined
	const comparisonPoints = previousSeries
		? toPoints(
				customRange
					? bucketByRange(previousSeries, customRange, result.timezone)
					: bucketSeries(previousSeries, timeframe, result.timezone)
			)
		: undefined
	return (
		<div className="analytics-trend-widget" style={cardStyle}>
			<span style={labelStyle}>{title}</span>
			<span
				style={{
					fontSize: '1.75rem',
					fontWeight: 700,
					lineHeight: 1.1,
					color: 'var(--theme-elevation-800)',
				}}
			>
				{formatMetricValue(metric, result.total, locale)}
			</span>
			<TrendChart
				buckets={trendPoints}
				{...(comparisonPoints && result.comparisonRange
					? {
							comparison: comparisonPoints,
							comparisonLabel: t(keys.viewTrendPrevious),
							comparisonRange: formatRangeCaption(result.comparisonRange, locale, result.timezone),
							label: title,
						}
					: {})}
				ariaLabel={`${title} ${caption}`}
				minHeight={180}
			/>
			<span style={{ fontSize: '0.75rem', color: 'var(--theme-elevation-400)' }}>{caption}</span>
			{result.comparisonRange ? (
				<ComparisonDelta
					current={result.total}
					previous={result.previousTotal}
					metric={metric}
					locale={locale}
					t={t}
				/>
			) : null}
			{result.clamped ? (
				<span style={{ fontSize: '0.6875rem', color: 'var(--theme-elevation-400)' }}>
					{t(keys.stateClamped)}
				</span>
			) : null}
			<WidgetViewLink href={href} label={t(keys.widgetOpenInView)} />
		</div>
	)
}
