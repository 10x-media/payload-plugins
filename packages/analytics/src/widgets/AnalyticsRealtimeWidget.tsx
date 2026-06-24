import type { WidgetServerProps } from 'payload'
import type { MetricKey } from '../core/contract'
import { REALTIME_PATH } from '../plugin/realtimeEndpoint'
import { keys, type TranslationKey } from '../translations/keys'
import { METRIC_KEYS } from '../translations/metricKeys'
import { asTranslate } from '../translations/server'
import { cardStyle, labelStyle } from './cardChrome'
import { RealtimeCounter } from './RealtimeCounter'
import { readForWidgetRealtime, type WidgetRealtimeStatus } from './readForWidgetRealtime'

const STATE_KEY: Record<Exclude<WidgetRealtimeStatus, 'ok'>, TranslationKey> = {
	'not-configured': keys.stateNotConfigured,
	unavailable: keys.stateUnavailable,
}

interface RealtimeWidgetData {
	title?: string
	metric?: 'visitors' | 'pageviews'
	windowMinutes?: number | string
	dataSource?: string
}

const POLL_INTERVAL_MS = 15_000

export default async function AnalyticsRealtimeWidget(props: WidgetServerProps) {
	const data = (props.widgetData ?? {}) as RealtimeWidgetData
	const metric: MetricKey = data.metric ?? 'visitors'
	const windowMinutes = Number(data.windowMinutes) || 30
	const t = asTranslate(props.req.i18n.t)
	const locale = props.req.i18n.language ?? 'en-US'
	const title = data.title?.trim() || t(keys.widgetRealtimeLabel)

	const result = await readForWidgetRealtime({
		req: props.req,
		metric,
		windowMinutes,
		adapterId: data.dataSource,
		now: new Date(),
	})

	if (result.status !== 'ok') {
		return (
			<div className="analytics-realtime-widget" style={cardStyle}>
				<span style={labelStyle}>{title}</span>
				<span style={{ color: 'var(--theme-elevation-400)' }}>{t(STATE_KEY[result.status])}</span>
			</div>
		)
	}

	const caption = `${t(METRIC_KEYS[metric])} ${t(keys.widgetRealtimeCaption)}`
	return (
		<div className="analytics-realtime-widget" style={cardStyle}>
			<span style={labelStyle}>{title}</span>
			<RealtimeCounter
				endpoint={`/api${REALTIME_PATH}`}
				intervalMs={POLL_INTERVAL_MS}
				metric={metric}
				windowMinutes={windowMinutes}
				dataSource={data.dataSource}
				initialActiveNow={result.activeNow}
				initialSeries={result.series}
				locale={locale}
				caption={caption}
				pausedLabel={t(keys.widgetRealtimePaused)}
			/>
		</div>
	)
}
