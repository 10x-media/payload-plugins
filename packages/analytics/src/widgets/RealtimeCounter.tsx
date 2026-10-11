'use client'

import { useMemo } from 'react'
import { TrendChart } from '../charts/TrendChart'
import { formatMinutes } from '../fields/format'
import { numberFormat } from '../translations/intl'
import type { PluralName } from '../translations/keys'
import { type PluralPhrase, plural, pluralParts } from '../translations/plural'
import { useTranslation } from '../translations/useTranslation'
import { LiveAnnouncement } from '../ui/components/LiveAnnouncement'
import { useRealtimePoll } from '../ui/hooks/useRealtimePoll'
import type { RealtimePoint } from './readForWidgetRealtime'
import { buildPollPath, type RealtimeReading, toRealtimePoints } from './realtimePoll'
import { WidgetBody, WidgetNote, WidgetValue } from './WidgetCard'

/** @beta */
export interface RealtimeCounterProps {
	endpoint: string
	intervalMs: number
	metric: string
	windowMinutes: number
	dataSource?: string
	/** Read another scope; the endpoint refuses any caller that may not. */
	scope?: string
	initialActiveNow: number
	initialSeries: RealtimePoint[]
	/** Whether the reading it mounts with was counted from a sample. */
	initialSampled?: boolean
	locale: string
	/** Reporting timezone the minute labels read in, so server and browser agree. */
	timezone: string
	/** Names the sparkline for assistive tech, as the metric's own name does. */
	label: string
	/**
	 * Words beside the number, the same for every count. Left out, the plugin's own phrase for
	 * `metric`, worded for the count in the admin's language.
	 */
	caption?: string
	pausedLabel: string
	/** Notice for a sampled reading; without it the counter renders none. */
	sampledLabel?: string
	/** Heads the minutes column of the sparkline's data table, which only assistive tech sees. */
	periodLabel?: string
	/** Let the sparkline take the height its card has to spare, as a dashboard widget's does. */
	fill?: boolean
}

export interface RealtimeReadoutProps {
	reading: RealtimeReading
	paused: boolean
	locale: string
	timezone: string
	/** The phrase the count is worded in, chosen per count in the admin's language. */
	phrase: PluralName
	/** The minutes the count covers, which a phrase names as its `{{duration}}`. */
	windowMinutes?: number
	/** Names the sparkline for assistive tech. */
	label: string
	/** A fixed caption in place of the phrase, as a host's own counter may pass. */
	caption?: string
	pausedLabel: string
	sampledLabel?: string
	periodLabel?: string
	fill?: boolean
}

/**
 * Three minutes on the axis, the window's first, middle and last: a counter sits in a narrow card,
 * and a 12-hour clock's labels with the zone beside the last are wide.
 */
const REALTIME_TICKS = 3

const captionSpan = (text: string) =>
	text === '' ? null : <span className="analytics-widget__value-caption">{text}</span>

/**
 * A live reading: the number, large inside its phrase wherever the language places it, then a
 * sparkline of its last minutes.
 */
export function RealtimeReadout({
	reading,
	paused,
	locale,
	timezone,
	phrase,
	windowMinutes,
	label,
	caption,
	pausedLabel,
	sampledLabel,
	periodLabel,
	fill = false,
}: RealtimeReadoutProps) {
	const translation = useTranslation()
	const points = toRealtimePoints(reading.series, locale, timezone)
	const counted: PluralPhrase =
		windowMinutes === undefined
			? phrase
			: { name: phrase, vars: { duration: formatMinutes(windowMinutes, locale) } }
	const parts =
		caption === undefined
			? pluralParts(translation, counted, reading.activeNow)
			: {
					before: '',
					count: numberFormat(locale).format(reading.activeNow),
					after: caption,
				}
	const spoken =
		caption === undefined
			? plural(translation, counted, reading.activeNow)
			: `${parts.count} ${caption}`
	return (
		<>
			<WidgetValue before={paused ? null : captionSpan(parts.before.trim())} value={parts.count}>
				{captionSpan(paused ? pausedLabel : parts.after.trim())}
			</WidgetValue>
			<WidgetBody>
				<TrendChart
					ariaLabel={label}
					buckets={points}
					fill={fill}
					maxTicks={REALTIME_TICKS}
					minHeight={fill ? 100 : 120}
					{...(periodLabel === undefined ? {} : { periodLabel })}
				/>
			</WidgetBody>
			{reading.sampled && sampledLabel ? <WidgetNote>{sampledLabel}</WidgetNote> : null}
			<LiveAnnouncement message={paused ? pausedLabel : spoken} />
		</>
	)
}

/**
 * A live count that mounts with a server-rendered reading and polls it fresh. A new server
 * reading (widget re-rendered) replaces the polled one rather than being stranded behind it.
 *
 * @beta
 */
export function RealtimeCounter(props: RealtimeCounterProps) {
	const { endpoint, intervalMs, metric, windowMinutes, dataSource, scope } = props
	const { initialActiveNow, initialSeries, initialSampled } = props
	const initial = useMemo<RealtimeReading>(
		() => ({
			activeNow: initialActiveNow,
			series: initialSeries,
			sampled: initialSampled === true,
		}),
		[initialActiveNow, initialSeries, initialSampled]
	)
	const url = buildPollPath(endpoint, {
		metric,
		windowMinutes,
		...(dataSource === undefined ? {} : { dataSource }),
		...(scope === undefined ? {} : { scope }),
	})
	const poll = useRealtimePoll({ url, intervalMs, initial })
	return (
		<RealtimeReadout
			{...(props.caption === undefined ? {} : { caption: props.caption })}
			{...(props.fill === undefined ? {} : { fill: props.fill })}
			label={props.label}
			locale={props.locale}
			phrase={metric === 'pageviews' ? 'livePageviews' : 'liveVisitors'}
			windowMinutes={windowMinutes}
			paused={poll.paused}
			pausedLabel={props.pausedLabel}
			reading={poll.reading ?? initial}
			{...(props.sampledLabel === undefined ? {} : { sampledLabel: props.sampledLabel })}
			{...(props.periodLabel === undefined ? {} : { periodLabel: props.periodLabel })}
			timezone={props.timezone}
		/>
	)
}
