import type { WidgetServerProps } from 'payload'
import type { MetricKey } from '../core/contract'
import { formatMetricValue } from '../fields/format'
import type { TimeframePreset } from '../timeframe/presets'
import { keys, type TranslationKey } from '../translations/keys'
import { METRIC_KEYS, TIMEFRAME_KEYS } from '../translations/metricKeys'
import { asTranslate } from '../translations/server'
import { cardStyle, labelStyle } from './cardChrome'
import { readForWidget, type WidgetReadStatus } from './readForWidget'
import type { MetricWidgetData } from './types'

const STATE_KEY: Record<Exclude<WidgetReadStatus, 'ok'>, TranslationKey> = {
	'not-configured': keys.stateNotConfigured,
	unavailable: keys.stateUnavailable,
}

export default async function AnalyticsMetricWidget(props: WidgetServerProps) {
	const data = (props.widgetData ?? {}) as MetricWidgetData
	const metric: MetricKey = data.metric ?? 'pageviews'
	const timeframe: TimeframePreset = data.timeframe ?? 'last30days'
	const t = asTranslate(props.req.i18n.t)
	const locale = props.req.i18n.language ?? 'en-US'
	const title = data.title?.trim() || t(METRIC_KEYS[metric])

	const result = await readForWidget({
		req: props.req,
		metrics: [metric],
		timeframe,
		adapterId: data.dataSource,
		now: new Date(),
	})

	if (result.status !== 'ok') {
		return (
			<div className="analytics-metric-widget" style={cardStyle}>
				<span style={labelStyle}>{title}</span>
				<span style={{ color: 'var(--theme-elevation-400)' }}>{t(STATE_KEY[result.status])}</span>
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
			<span style={{ fontSize: '0.75rem', color: 'var(--theme-elevation-400)' }}>
				{t(TIMEFRAME_KEYS[timeframe])}
			</span>
		</div>
	)
}
