'use client'

import type { ReactNode } from 'react'
import { labelSeries, unitForTimeframe } from '../charts/bucket'
import { markInProgress } from '../charts/inProgress'
import { TrendChart } from '../charts/TrendChart'
import type { MetricKey, MetricValue } from '../core/contract'
import { readingOf } from '../core/metricValues'
import type { TimeframePreset } from '../timeframe/presets'
import { intlLocale } from '../translations/intl'
import { keys, type TranslationKey } from '../translations/keys'
import { METRIC_KEYS, metricLabelKey, TIMEFRAME_KEYS } from '../translations/metricKeys'
import { useTranslation } from '../translations/useTranslation'
import { MetricCard } from '../ui/components/MetricCard'
import { viewerNow } from '../ui/viewerClock'
import type { CountryFlags } from '../view/CountryFlag'
import { clickRate } from '../view/conversionRate'
import { ComparisonDelta } from '../widgets/ComparisonDelta'
import { widgetNotice } from '../widgets/notices'
import { mergeNotices } from '../widgets/readMeta'
import type { PanelData } from './AnalyticsPanelClient'
import { AnalyticsEmptyState, isEmptyDocumentRead } from './emptyState'
import { formatMetricValue, formatRate } from './format'
import { itemMetricLabel } from './itemReport'
import { PanelList } from './PanelList'

/**
 * Item report cards in reading order. A rate is derived from the two counts beside it rather than
 * read, so it shows whenever both are there.
 */
type ItemCard =
	| { kind: 'metric'; metric: MetricKey }
	| { kind: 'rate'; id: string; of: MetricKey; over: MetricKey; label: TranslationKey }

const ITEM_CARDS: ItemCard[] = [
	{ kind: 'metric', metric: 'impressions' },
	{ kind: 'metric', metric: 'visitors' },
	{ kind: 'metric', metric: 'interactions' },
	{
		kind: 'rate',
		id: 'click-rate',
		of: 'interactions',
		over: 'impressions',
		label: keys.metricClickRate,
	},
	{ kind: 'metric', metric: 'conversions' },
	{
		kind: 'rate',
		id: 'conversion-rate',
		of: 'conversions',
		over: 'impressions',
		label: keys.viewConversionRate,
	},
	{ kind: 'metric', metric: 'revenue' },
]

/** Lists the panel lays out under its trend; no read it makes ranks more. */
const MAX_PANEL_LISTS = 3

/** Height the trend keeps in the panel's narrow column. */
const TREND_MIN_HEIGHT = 140

/** "Updated 3 minutes ago" is worded against the clock of whichever side renders. */
const noticeLine = (text: string) =>
	text === '' ? null : (
		<span className="analytics-panel__notice" suppressHydrationWarning>
			{text}
		</span>
	)

interface ShownCard {
	id: string
	label: string
	display: string
	current: MetricValue
	previous: MetricValue | undefined
	metric?: MetricKey
}

interface PanelContentProps {
	data: PanelData
	/** The window the numbers were read for, which the caption, chart and formatters follow. */
	timeframe: TimeframePreset
	/** When the numbers were read, which decides the bucket that is still counting. */
	readAt: string
	/** Page card labels the developer set, resolved to plain strings. */
	labels: Partial<Record<MetricKey, string>> | undefined
	/** Item card labels the developer set; other cards keep the item report's own names. */
	itemLabelOverrides: Partial<Record<MetricKey, string>> | undefined
	/** ISO 4217 code revenue renders in when the read names none; absent leaves it a plain number. */
	currency: string | undefined
	countryFlags: CountryFlags
	/** Offered beside the note that part of the read failed. */
	retryButton: ReactNode
}

/**
 * An answered read: its cards, trend, lists, caption and notices, or a line saying nothing was
 * counted in the window.
 */
export function PanelContent(props: PanelContentProps) {
	const { data, timeframe, labels, countryFlags } = props
	const { t, i18n } = useTranslation()
	const locale = intlLocale(i18n.language)
	const item = data.report === 'item'
	const currency = data.notices?.currency ?? props.currency
	// One line for the whole panel: the cards, the trend and every list read the same days.
	const timeZone = data.timezone ?? 'UTC'
	const substituted = { substitutedFrom: data.substitutedFrom }

	if (isEmptyDocumentRead(data)) {
		// No cards or lists, so no revenue sum or grouped row needs explaining.
		const emptyNotice = widgetNotice(
			{ ...mergeNotices(data.notices), ...substituted, mixedCurrencies: [], capped: false },
			{ t, locale, now: viewerNow(), timeZone }
		)
		return (
			<div className="analytics-panel__content">
				<AnalyticsEmptyState isNew={false}>
					{t(item ? keys.panelNoViews : keys.panelNoVisits)}
				</AnalyticsEmptyState>
				{noticeLine(emptyNotice)}
			</div>
		)
	}

	const notice = widgetNotice(
		{ ...mergeNotices(data.notices, ...(data.breakdowns ?? [])), ...substituted },
		{ t, locale, now: viewerNow(), timeZone }
	)
	const firstMetric = data.supportedMetrics[0]
	// An hourly chart needs hourly rows: a source that serves none has a single value for the
	// window, which the metric cards already show, and a one-point line to nowhere otherwise.
	const chartable = unitForTimeframe(timeframe) !== 'hour' || data.seriesGranularity === 'hour'
	// Every offered window runs up to when it was read, so its last bucket is still counting.
	const now = new Date(props.readAt)
	const bucketed =
		chartable && data.points && data.points.length > 0 && firstMetric
			? markInProgress(
					labelSeries(data.points, {
						granularity: data.seriesGranularity ?? 'day',
						tz: data.timezone,
						locale,
						weekday: timeframe === 'last7days',
						...(data.dateRange ? { from: new Date(data.dateRange.start) } : {}),
					}).map((b) => ({
						...b,
						display: formatMetricValue(firstMetric, b.value, { locale, currency }),
					})),
					{ now, end: now, soFar: (period) => t(keys.chartSoFar, { period }) }
				)
			: null
	// An average with no reading on any day has nothing to draw: the card above already says so.
	const buckets = bucketed?.some((b) => b.value !== null) ? bucketed : null
	const served = new Set(data.supportedMetrics)

	const card = (shown: ShownCard) => (
		<MetricCard
			className="analytics-panel__card"
			key={shown.id}
			label={shown.label}
			noValueLabel={t(keys.stateNoValue)}
			value={shown.display}
		>
			{data.comparisonRange ? (
				<ComparisonDelta
					current={shown.current}
					previous={shown.previous}
					{...(shown.metric === undefined ? {} : { metric: shown.metric })}
					locale={locale}
					t={t}
				/>
			) : null}
		</MetricCard>
	)

	const metricCard = (metric: MetricKey, label: string) => {
		const value = readingOf(data.metrics, metric)
		return card({
			id: metric,
			label,
			display: formatMetricValue(metric, value, { locale, currency }),
			current: value,
			previous: data.previousMetrics?.[metric],
			metric,
		})
	}

	const pageCards = () =>
		data.supportedMetrics.map((metric) =>
			metricCard(
				metric,
				labels?.[metric] ?? t(metricLabelKey(metric, data.notices?.visitorsSummed))
			)
		)

	const itemCards = () =>
		ITEM_CARDS.flatMap((spec) => {
			if (spec.kind === 'metric') {
				if (!served.has(spec.metric)) {
					return []
				}
				const label =
					props.itemLabelOverrides?.[spec.metric] ??
					t(itemMetricLabel(spec.metric, METRIC_KEYS[spec.metric]))
				return [metricCard(spec.metric, label)]
			}
			if (!served.has(spec.of) || !served.has(spec.over)) {
				return []
			}
			const rate = clickRate(data.metrics[spec.of], data.metrics[spec.over])
			const previous = data.previousMetrics
				? clickRate(data.previousMetrics[spec.of], data.previousMetrics[spec.over])
				: undefined
			return [
				card({
					id: spec.id,
					label: t(spec.label),
					display: formatRate(rate, locale),
					current: rate,
					previous,
				}),
			]
		})

	const charted = item ? keys.metricImpressions : firstMetric && METRIC_KEYS[firstMetric]
	const trendLabel = charted
		? t(keys.chartLabel, { metric: t(charted), window: t(TIMEFRAME_KEYS[timeframe]) })
		: ''
	const lists = data.breakdowns ?? []

	return (
		<div className="analytics-panel__content">
			<div className="analytics-panel__cards">{item ? itemCards() : pageCards()}</div>
			{buckets && firstMetric ? (
				<TrendChart
					ariaLabel={trendLabel}
					buckets={buckets}
					keyboardHint={t(keys.chartKeyboardHint)}
					noValueLabel={t(keys.stateNoValue)}
					label={
						item
							? t(keys.metricImpressions)
							: (labels?.[firstMetric] ?? t(METRIC_KEYS[firstMetric]))
					}
					minHeight={TREND_MIN_HEIGHT}
					periodLabel={t(keys.viewTrendPeriod)}
				/>
			) : null}
			{lists.length > 0 ? (
				<div className="analytics-panel__lists">
					{lists.slice(0, MAX_PANEL_LISTS).map((block) => (
						<PanelList
							block={block}
							countryFlags={countryFlags}
							currency={currency}
							item={item}
							key={block.dimension}
						/>
					))}
				</div>
			) : null}
			<span className="analytics-panel__caption">{t(TIMEFRAME_KEYS[timeframe])}</span>
			{noticeLine(notice)}
			{data.incomplete ? (
				<div className="analytics-panel__state">
					{noticeLine(t(keys.statePartsFailed))}
					{props.retryButton}
				</div>
			) : null}
		</div>
	)
}
