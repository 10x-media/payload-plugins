import type { WidgetServerProps } from 'payload'
import { TrendChart } from '../charts/TrendChart'
import type { MetricKey } from '../core/contract'
import { formatMetricValue } from '../fields/format'
import type { TimeframePreset } from '../timeframe/presets'
import { keys, type TranslationKey } from '../translations/keys'
import { METRIC_KEYS, TIMEFRAME_KEYS } from '../translations/metricKeys'
import { asTranslate } from '../translations/server'
import { cardStyle, labelStyle } from './cardChrome'
import type { WidgetReadStatus } from './readForWidget'
import { readForWidgetSeries } from './readForWidgetSeries'
import type { MetricWidgetData } from './types'

const STATE_KEY: Record<Exclude<WidgetReadStatus, 'ok'>, TranslationKey> = {
	'not-configured': keys.stateNotConfigured,
	unavailable: keys.stateUnavailable,
}

export default async function AnalyticsTrendWidget(props: WidgetServerProps) {
	const data = (props.widgetData ?? {}) as MetricWidgetData
	const metric: MetricKey = data.metric ?? 'pageviews'
	const timeframe: TimeframePreset = data.timeframe ?? 'last30days'
	const t = asTranslate(props.req.i18n.t)
	const locale = props.req.i18n.language ?? 'en-US'
	const title = data.title?.trim() || t(METRIC_KEYS[metric])

	const result = await readForWidgetSeries({
		req: props.req,
		metric,
		timeframe,
		adapterId: data.dataSource,
		now: new Date(),
	})

	if (result.status !== 'ok') {
		return (
			<div className="analytics-trend-widget" style={cardStyle}>
				<span style={labelStyle}>{title}</span>
				<span style={{ color: 'var(--theme-elevation-400)' }}>{t(STATE_KEY[result.status])}</span>
			</div>
		)
	}

	const caption = t(TIMEFRAME_KEYS[timeframe])
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
				values={result.points.map((p) => p.value)}
				ariaLabel={`${title} ${caption}`}
				height={56}
			/>
			<span style={{ fontSize: '0.75rem', color: 'var(--theme-elevation-400)' }}>{caption}</span>
		</div>
	)
}
