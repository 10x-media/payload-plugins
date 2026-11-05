import { isRecord } from '../core/values'
import { type ApiPathConfigSource, apiPath } from '../plugin/apiPath'
import { analyticsRoutes, type RoutesConfigSource } from '../plugin/routes'
import { dateTimeFormat, numberFormat } from '../translations/intl'
import { QueryFetchError } from '../ui/data/request'
import type { RealtimePoint } from './readForWidgetRealtime'

export interface PollConfig {
	metric: string
	windowMinutes: number
	dataSource?: string
	/** Read another scope; the endpoint refuses any caller that may not. */
	scope?: string
	/** False asks for the window's total alone, without its per-minute series. */
	series?: boolean
}

export interface RealtimeChartPoint {
	/** The minute's ISO instant; identity for the chart's React lists. */
	at: string
	label: string
	/** The minute with its zone, as the tooltip and the data table read it. */
	tooltipLabel: string
	value: number
	display: string
}

/** The live endpoint, relative and behind the Next basePath. */
export const buildRealtimeEndpoint = (config: ApiPathConfigSource & RoutesConfigSource): string =>
	apiPath(config, analyticsRoutes(config).live)

export const buildPollPath = (endpoint: string, config: PollConfig): string => {
	const params = new URLSearchParams({
		metric: config.metric,
		windowMinutes: String(config.windowMinutes),
	})
	if (config.dataSource) {
		params.set('dataSource', config.dataSource)
	}
	if (config.scope) {
		params.set('scope', config.scope)
	}
	if (config.series === false) {
		params.set('series', '0')
	}
	return `${endpoint}?${params.toString()}`
}

/**
 * Whether a failed poll is worth repeating: only a refusal aimed at this reader (`401` or `403`)
 * is final; outages, unreadable answers and network failures keep polling.
 */
export const isPollRefusalFinal = (err: unknown): boolean =>
	err instanceof QueryFetchError && (err.status === 401 || err.status === 403)

/** One live reading as the counters show it. */
export interface RealtimeReading {
	activeNow: number
	series: RealtimePoint[]
	sampled: boolean
}

const isPoint = (value: unknown): value is RealtimePoint =>
	isRecord(value) && typeof value.date === 'string' && typeof value.value === 'number'

/**
 * The reading in a live endpoint answer, or null for an answer that carries none: a status other
 * than `ok` (no page to count on, a source that cannot count live) reads as a paused counter.
 */
export const readRealtimeReading = (body: unknown): RealtimeReading | null => {
	if (!isRecord(body) || body.status !== 'ok' || typeof body.activeNow !== 'number') {
		return null
	}
	return {
		activeNow: body.activeNow,
		series: Array.isArray(body.series) ? body.series.filter(isPoint) : [],
		sampled: body.sampled === true,
	}
}

/** The short name of `timeZone` at `at` in `locale`: `UTC`, `CEST`, `GMT+2`. */
const zoneName = (at: Date, locale: string, timeZone: string): string =>
	dateTimeFormat(locale, { timeZone, timeZoneName: 'short' })
		.formatToParts(at)
		.find((part) => part.type === 'timeZoneName')?.value ?? timeZone

/**
 * A minute series as TrendChart points, labelled in `timeZone` (the reporting zone) rather than
 * the runtime's, so server render and browser hydration agree on every label.
 */
export const toRealtimePoints = (
	series: RealtimePoint[],
	locale: string,
	timeZone: string
): RealtimeChartPoint[] => {
	const nf = numberFormat(locale)
	const time = dateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone })
	return series.map((p, i) => {
		const at = new Date(p.date)
		const minute = time.format(at)
		const zoned = `${minute} ${zoneName(at, locale, timeZone)}`
		return {
			at: p.date,
			label: i === series.length - 1 ? zoned : minute,
			tooltipLabel: zoned,
			value: p.value,
			display: nf.format(p.value),
		}
	})
}
