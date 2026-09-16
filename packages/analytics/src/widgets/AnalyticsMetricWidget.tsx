import type { WidgetServerProps } from 'payload'
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
import { filterCaption } from './filterCaption'
import { widgetFilters } from './filterField'
import { formatRangeCaption, resolveCustomRange } from './range'
import { readForWidget, type WidgetReadStatus } from './readForWidget'
import type { MetricWidgetData } from './types'
import { type WidgetViewProps, widgetViewHref } from './viewLink'
import { WidgetViewLink } from './WidgetViewLink'

const STATE_KEY: Record<Exclude<WidgetReadStatus, 'ok'>, TranslationKey> = {
	'not-configured': keys.stateNotConfigured,
	unavailable: keys.stateUnavailable,
	'filter-unsupported': keys.stateFilterUnsupported,
}

export default async function AnalyticsMetricWidget(props: WidgetServerProps & WidgetViewProps) {
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
	const filters = widgetFilters(data)
	const windowCaption =
		customRange && timezone
			? formatRangeCaption(customRange, locale, timezone)
			: t(TIMEFRAME_KEYS[timeframe])
	const caption = filters[0] ? `${windowCaption} ${filterCaption(filters[0], t)}` : windowCaption
	const result = await readForWidget({
		req: props.req,
		metrics: [metric],
		timeframe,
		adapterId: data.dataSource,
		now: new Date(),
		range: customRange,
		filters,
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
		filters,
	})

	if (result.status !== 'ok') {
		return (
			<div className="analytics-metric-widget" style={cardStyle}>
				<span style={labelStyle}>{title}</span>
				<span style={{ color: 'var(--theme-elevation-400)' }}>{t(STATE_KEY[result.status])}</span>
				<WidgetViewLink href={href} label={t(keys.widgetOpenInView)} />
			</div>
		)
	}

	const value = result.metrics[metric]
	return (
		<div className="analytics-metric-widget" style={cardStyle}>
			<span style={labelStyle}>{title}</span>
			<span
				style={{
					fontSize: '2rem',
					fontWeight: 700,
					lineHeight: 1.1,
					color: 'var(--theme-elevation-800)',
				}}
			>
				{value === undefined ? '–' : formatMetricValue(metric, value, locale)}
			</span>
			<span style={{ fontSize: '0.75rem', color: 'var(--theme-elevation-400)' }}>{caption}</span>
			{result.comparisonRange ? (
				<ComparisonDelta
					current={value}
					previous={result.previousMetrics?.[metric]}
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
