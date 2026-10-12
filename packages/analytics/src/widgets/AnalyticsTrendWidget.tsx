import { labelSeries, unitForRange } from '../charts/bucket'
import { markInProgress } from '../charts/inProgress'
import { TrendChart, type TrendPoint } from '../charts/TrendChart'
import { currentDate } from '../core/clock'
import { formatMetricValue } from '../fields/format'
import { revenueCurrencyOf } from '../goals/currency'
import { requestCurrency } from '../plugin/runtime'
import { intlLocale } from '../translations/intl'
import { keys } from '../translations/keys'
import { asTranslate } from '../translations/server'
import { ComparisonDelta } from './ComparisonDelta'
import { widgetFilters } from './filterField'
import { widgetNotice } from './notices'
import { formatRangeCaption } from './range'
import { readForWidgetSeries } from './readForWidgetSeries'
import { metricWidgetTitle, placeholderTitle } from './titleForecast'
import type { MetricWidgetData } from './types'
import { type AnalyticsWidgetProps, widgetLink } from './viewLink'
import { WidgetBody, WidgetCard, WidgetNote, WidgetValue } from './WidgetCard'
import { WidgetFrame, WidgetStateCard } from './WidgetFrame'
import { storedWidgetData } from './widgetData'
import { resolveWidgetWindow, widgetCaption, windowReadArgs } from './widgetWindow'

const CLASS_NAME = 'analytics-trend-widget'

const CHART_MIN_HEIGHT = 140

const dataOf = (props: AnalyticsWidgetProps): MetricWidgetData => storedWidgetData(props.widgetData)

/**
 * The card's frame paints at once; its total and chart stream in when the read answers.
 *
 * @beta
 */
export default function AnalyticsTrendWidget(props: AnalyticsWidgetProps) {
	return (
		<WidgetFrame
			className={CLASS_NAME}
			kind="trend"
			widget={props}
			{...placeholderTitle(props.req, dataOf(props), { series: true })}
		>
			<TrendWidgetBody {...props} />
		</WidgetFrame>
	)
}

async function TrendWidgetBody(props: AnalyticsWidgetProps) {
	const data = dataOf(props)
	const metric = data.metric ?? 'pageviews'
	const t = asTranslate(props.req.i18n.t)
	const locale = intlLocale(props.req.i18n.language)
	const title = metricWidgetTitle(data, t)
	const window = await resolveWidgetWindow(props.req, data)
	if (window.unreadable) {
		return (
			<WidgetStateCard
				className={CLASS_NAME}
				locale={locale}
				status="invalid"
				t={t}
				title={title}
			/>
		)
	}
	const reporting = await requestCurrency(props.req)
	const compare = data.compare === true
	const filters = widgetFilters(data)
	const now = currentDate()
	const result = await readForWidgetSeries({
		req: props.req,
		metric,
		adapterId: data.dataSource,
		now,
		compare,
		filters,
		...windowReadArgs(window),
	})
	const link = widgetLink(props, t, {
		window,
		adapterId: result.adapterId,
		metric,
		compare,
		filters,
	})
	if (result.status !== 'ok') {
		return (
			<WidgetStateCard
				className={CLASS_NAME}
				link={link}
				locale={locale}
				retryAfterMs={result.retryAfterMs}
				status={result.status}
				t={t}
				title={title}
			/>
		)
	}

	const currency = result.currency ?? revenueCurrencyOf(filters, reporting)
	const caption = await widgetCaption(props.req, { window, filters, read: result, locale, t })
	const notice = widgetNotice(result, { t, locale, now, timeZone: result.timezone })
	// A window charted by hour needs hourly rows; without them the headline total above is the
	// whole answer, and a one-point line under it would only look like a broken chart.
	const chartable = unitForRange(result.dateRange) !== 'hour' || result.seriesGranularity === 'hour'
	const format = (value: TrendPoint['value']): string =>
		formatMetricValue(metric, value, { locale, currency })
	const trendPoints: TrendPoint[] = markInProgress(
		labelSeries(result.points, {
			granularity: result.seriesGranularity ?? 'day',
			tz: result.timezone,
			locale,
			weekday: !window.range && window.timeframe === 'last7days',
			from: result.dateRange.start,
		}).map((bucket) => ({ ...bucket, display: format(bucket.value) })),
		{ now, end: result.dateRange.end, soFar: (period) => t(keys.chartSoFar, { period }) }
	)
	// The read aligned the previous window to these buckets by index, so it borrows their labels.
	const comparisonPoints: TrendPoint[] | undefined =
		compare && result.comparisonPoints
			? trendPoints.map((bucket, i) => {
					const value = result.comparisonPoints?.[i]?.value ?? null
					return { ...bucket, value, display: format(value) }
				})
			: undefined
	// An average with no reading on any day has no line to draw; the dash above says so.
	const drawable = trendPoints.some((point) => point.value !== null)
	return (
		<WidgetCard
			className={CLASS_NAME}
			caption={caption}
			link={link}
			title={metricWidgetTitle(data, t, result.visitorsSummed)}
		>
			<WidgetValue
				noValueLabel={t(keys.stateNoValue)}
				value={formatMetricValue(metric, result.total, { locale, currency })}
			>
				{result.comparisonRange ? (
					<ComparisonDelta
						current={result.total}
						previous={result.previousTotal}
						metric={metric}
						locale={locale}
						t={t}
					/>
				) : null}
			</WidgetValue>
			{chartable && drawable ? (
				<WidgetBody>
					<TrendChart
						buckets={trendPoints}
						{...(comparisonPoints && result.comparisonRange
							? {
									comparison: comparisonPoints,
									comparisonLabel: t(keys.viewTrendPrevious),
									comparisonRange: formatRangeCaption(
										result.comparisonRange,
										locale,
										result.timezone
									),
								}
							: {})}
						ariaLabel={`${title} ${caption}`}
						fill
						keyboardHint={t(keys.chartKeyboardHint)}
						label={title}
						minHeight={CHART_MIN_HEIGHT}
						noValueLabel={t(keys.stateNoValue)}
						periodLabel={t(keys.viewTrendPeriod)}
					/>
				</WidgetBody>
			) : null}
			<WidgetNote>{notice}</WidgetNote>
		</WidgetCard>
	)
}
