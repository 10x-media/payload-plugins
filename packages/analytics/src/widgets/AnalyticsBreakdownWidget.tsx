import type { WidgetServerProps } from 'payload'
import { BarList } from '../charts/BarList'
import type { MetricKey } from '../core/contract'
import { formatMetricValue } from '../fields/format'
import type { TimeframePreset } from '../timeframe/presets'
import { keys, type TranslationKey } from '../translations/keys'
import { TIMEFRAME_KEYS } from '../translations/metricKeys'
import { asTranslate } from '../translations/server'
import { type BreakdownWidgetData, breakdownSpecBySlug } from './breakdownTypes'
import { cardStyle, labelStyle } from './cardChrome'
import { formatRangeCaption, resolveCustomRange } from './range'
import type { WidgetReadStatus } from './readForWidget'
import { readForWidgetBreakdown } from './readForWidgetBreakdown'

const STATE_KEY: Record<Exclude<WidgetReadStatus, 'ok'>, TranslationKey> = {
	'not-configured': keys.stateNotConfigured,
	unavailable: keys.stateUnavailable,
}

export default async function AnalyticsBreakdownWidget(props: WidgetServerProps) {
	const spec = breakdownSpecBySlug(props.widgetSlug)
	const t = asTranslate(props.req.i18n.t)
	const data = (props.widgetData ?? {}) as BreakdownWidgetData
	const metric: MetricKey = data.metric ?? 'pageviews'
	const rawTimeframe = data.timeframe ?? 'last30days'
	const customRange = resolveCustomRange(rawTimeframe, data.range)
	const timeframe: TimeframePreset = rawTimeframe === 'custom' ? 'last30days' : rawTimeframe
	const limit = data.limit ?? 5
	const title = data.title?.trim() || (spec ? t(spec.label) : '')

	if (!spec) {
		return (
			<div className="analytics-breakdown-widget" style={cardStyle}>
				<span style={{ color: 'var(--theme-elevation-400)' }}>{t(keys.stateUnavailable)}</span>
			</div>
		)
	}

	const result = await readForWidgetBreakdown({
		req: props.req,
		metric,
		dimension: spec.dimension,
		timeframe,
		limit,
		adapterId: data.dataSource,
		now: new Date(),
		range: customRange,
	})

	const locale = props.req.i18n.language ?? 'en-US'
	const caption = customRange
		? formatRangeCaption(customRange, locale)
		: t(TIMEFRAME_KEYS[timeframe])
	return (
		<div className="analytics-breakdown-widget" style={cardStyle}>
			<span style={labelStyle}>{title}</span>
			{result.status !== 'ok' ? (
				<span style={{ color: 'var(--theme-elevation-400)' }}>{t(STATE_KEY[result.status])}</span>
			) : (
				<BarList
					data={result.rows.map((row) => ({
						label: row.label,
						value: row.value,
						display: formatMetricValue(metric, row.value, locale),
					}))}
					emptyLabel={t(keys.stateNoBreakdown)}
				/>
			)}
			<span style={{ fontSize: '0.75rem', color: 'var(--theme-elevation-400)' }}>{caption}</span>
			{result.status === 'ok' && result.clamped ? (
				<span style={{ fontSize: '0.6875rem', color: 'var(--theme-elevation-400)' }}>
					{t(keys.stateClamped)}
				</span>
			) : null}
		</div>
	)
}
