import { REALTIME_PATH } from '../plugin/paths'
import type { RealtimePoint } from './readForWidgetRealtime'

export interface PollConfig {
	metric: string
	windowMinutes: number
	dataSource?: string
}

export interface RealtimeChartPoint {
	label: string
	value: number
	display: string
}

/** Build the realtime endpoint's base URL from the app's configured API route, not a hardcoded `/api`. */
export const buildRealtimeEndpoint = (serverURL: string | undefined, apiRoute: string): string =>
	`${serverURL ?? ''}${apiRoute}${REALTIME_PATH}`

/** Build the realtime endpoint path + query string for a poll. */
export const buildPollPath = (endpoint: string, config: PollConfig): string => {
	const params = new URLSearchParams({
		metric: config.metric,
		windowMinutes: String(config.windowMinutes),
	})
	if (config.dataSource) {
		params.set('dataSource', config.dataSource)
	}
	return `${endpoint}?${params.toString()}`
}

/** Map a minute series to TrendChart points (HH:MM labels, locale-formatted values). */
export const toRealtimePoints = (series: RealtimePoint[], locale: string): RealtimeChartPoint[] => {
	const nf = new Intl.NumberFormat(locale)
	return series.map((p) => ({
		label: new Date(p.date).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
		value: p.value,
		display: nf.format(p.value),
	}))
}
