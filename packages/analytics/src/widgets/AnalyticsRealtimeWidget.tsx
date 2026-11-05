import { currentDate } from '../core/clock'
import { formatMinutes } from '../fields/format'
import { requestTimezone } from '../plugin/runtime'
import { intlLocale } from '../translations/intl'
import { keys } from '../translations/keys'
import { METRIC_KEYS } from '../translations/metricKeys'
import { asTranslate, type Translate } from '../translations/server'
import { widgetNotice } from './notices'
import { RealtimeCounter } from './RealtimeCounter'
import { readForWidgetRealtime } from './readForWidgetRealtime'
import { buildRealtimeEndpoint } from './realtimePoll'
import { type AnalyticsWidgetProps, widgetLink } from './viewLink'
import { WidgetCard, WidgetNote } from './WidgetCard'
import { WidgetFrame, WidgetStateCard } from './WidgetFrame'
import { storedWidgetData } from './widgetData'

const CLASS_NAME = 'analytics-realtime-widget'

const POLL_INTERVAL_MS = 15_000

const DEFAULT_WINDOW_MINUTES = 30

interface RealtimeWidgetData {
	title?: string
	metric?: 'visitors' | 'pageviews'
	windowMinutes?: number | string
	dataSource?: string
}

const dataOf = (props: AnalyticsWidgetProps): RealtimeWidgetData => {
	const { metric, ...stored } = storedWidgetData(props.widgetData)
	return { ...stored, ...(metric === 'visitors' || metric === 'pageviews' ? { metric } : {}) }
}

const titleOf = (data: RealtimeWidgetData, t: Translate): string =>
	data.title?.trim() || t(keys.widgetRealtimeLabel)

/**
 * The card's frame paints at once; the live count streams in when the read answers.
 *
 * @beta
 */
export default function AnalyticsRealtimeWidget(props: AnalyticsWidgetProps) {
	const t = asTranslate(props.req.i18n.t)
	return (
		<WidgetFrame
			className={CLASS_NAME}
			kind="realtime"
			title={titleOf(dataOf(props), t)}
			widget={props}
		>
			<RealtimeWidgetBody {...props} />
		</WidgetFrame>
	)
}

async function RealtimeWidgetBody(props: AnalyticsWidgetProps) {
	const data = dataOf(props)
	const metric = data.metric ?? 'visitors'
	const windowMinutes = Number(data.windowMinutes) || DEFAULT_WINDOW_MINUTES
	const t = asTranslate(props.req.i18n.t)
	const locale = intlLocale(props.req.i18n.language)
	const title = titleOf(data, t)
	// The counter's minute labels are server-rendered and rehydrated, so both sides have to
	// read them in the install's reporting zone rather than in whatever zone they run in.
	const timezone = await requestTimezone(props.req)
	const now = currentDate()
	const result = await readForWidgetRealtime({
		req: props.req,
		metric,
		windowMinutes,
		adapterId: data.dataSource,
		fallbackWhenUnreadable: true,
		now,
	})
	const link = widgetLink(props, t, { adapterId: result.adapterId })
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

	// The number formats its own unit and plural, so the template only places it.
	const duration = formatMinutes(windowMinutes, locale)
	return (
		<WidgetCard
			className={CLASS_NAME}
			caption={t(keys.widgetRealtimeWindow, { duration })}
			link={link}
			title={title}
		>
			<RealtimeCounter
				endpoint={buildRealtimeEndpoint(props.req.payload.config)}
				intervalMs={POLL_INTERVAL_MS}
				metric={metric}
				windowMinutes={windowMinutes}
				dataSource={result.substitutedFrom === undefined ? data.dataSource : result.adapterId}
				initialActiveNow={result.activeNow}
				initialSeries={result.series}
				initialSampled={result.sampled}
				locale={locale}
				timezone={timezone}
				label={t(METRIC_KEYS[metric])}
				pausedLabel={t(keys.widgetRealtimePaused)}
				periodLabel={t(keys.viewTrendPeriod)}
				sampledLabel={t(keys.stateSampled)}
				fill
			/>
			<WidgetNote>
				{widgetNotice(
					{ substitutedFrom: result.substitutedFrom },
					{ t, locale, now, timeZone: timezone }
				)}
			</WidgetNote>
		</WidgetCard>
	)
}
