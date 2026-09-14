import type { WidgetServerProps } from 'payload'
import type { MetricKey } from '../core/contract'
import { DEFAULT_VIEW } from '../core/options'
import { DEFAULT_TIMEZONE } from '../timeframe/tz'
import { keys, type TranslationKey } from '../translations/keys'
import { METRIC_KEYS } from '../translations/metricKeys'
import { asTranslate } from '../translations/server'
import { cardStyle, labelStyle } from './cardChrome'
import { RealtimeCounter } from './RealtimeCounter'
import { readForWidgetRealtime, type WidgetRealtimeStatus } from './readForWidgetRealtime'
import { buildRealtimeEndpoint } from './realtimePoll'
import { type WidgetViewProps, widgetViewHref } from './viewLink'
import { WidgetViewLink } from './WidgetViewLink'

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

export default async function AnalyticsRealtimeWidget(props: WidgetServerProps & WidgetViewProps) {
	const data = (props.widgetData ?? {}) as RealtimeWidgetData
	const metric: MetricKey = data.metric ?? 'visitors'
	const windowMinutes = Number(data.windowMinutes) || 30
	const t = asTranslate(props.req.i18n.t)
	const locale = props.req.i18n.language ?? 'en-US'
	const title = data.title?.trim() || t(keys.widgetRealtimeLabel)
	// A rolling few minutes is no window the view can hold, so the link opens it as configured.
	const href = widgetViewHref(props.view, props.req, {
		timeframe: DEFAULT_VIEW.defaultRange,
		timezone: DEFAULT_TIMEZONE,
		...(data.dataSource ? { source: data.dataSource } : {}),
	})

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
				<WidgetViewLink href={href} label={t(keys.widgetOpenInView)} />
			</div>
		)
	}

	const caption = `${t(METRIC_KEYS[metric])} ${t(keys.widgetRealtimeCaption)}`
	return (
		<div className="analytics-realtime-widget" style={cardStyle}>
			<span style={labelStyle}>{title}</span>
			<RealtimeCounter
				endpoint={buildRealtimeEndpoint(
					props.req.payload.config.serverURL,
					props.req.payload.config.routes.api
				)}
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
			<WidgetViewLink href={href} label={t(keys.widgetOpenInView)} />
		</div>
	)
}
