'use client'

import { useEffect, useState } from 'react'
import { TrendChart } from '../charts/TrendChart'
import type { RealtimePoint } from './readForWidgetRealtime'
import { buildPollPath, toRealtimePoints } from './realtimePoll'

export interface RealtimeCounterProps {
	endpoint: string
	intervalMs: number
	metric: string
	windowMinutes: number
	dataSource?: string
	initialActiveNow: number
	initialSeries: RealtimePoint[]
	/** Whether the reading it mounts with hit the source's event scan cap. */
	initialSampled?: boolean
	locale: string
	caption: string
	pausedLabel: string
	/** Notice for a sampled reading; without it the counter renders none. */
	sampledLabel?: string
}

export function RealtimeCounter(props: RealtimeCounterProps) {
	const {
		endpoint,
		intervalMs,
		metric,
		windowMinutes,
		dataSource,
		locale,
		caption,
		pausedLabel,
		sampledLabel,
	} = props
	const [activeNow, setActiveNow] = useState(props.initialActiveNow)
	const [series, setSeries] = useState(props.initialSeries)
	const [sampled, setSampled] = useState(props.initialSampled === true)
	const [paused, setPaused] = useState(false)

	useEffect(() => {
		let cancelled = false
		const path = buildPollPath(endpoint, { metric, windowMinutes, dataSource })
		const tick = async () => {
			try {
				const res = await fetch(path, { credentials: 'same-origin' })
				if (!res.ok) {
					if (!cancelled) setPaused(true)
					return
				}
				const data = (await res.json()) as {
					status: string
					activeNow: number
					series: RealtimePoint[]
					sampled?: boolean
				}
				if (cancelled || data.status !== 'ok') return
				setActiveNow(data.activeNow)
				setSeries(data.series)
				setSampled(data.sampled === true)
				setPaused(false)
			} catch {
				if (!cancelled) setPaused(true)
			}
		}
		const id = setInterval(tick, intervalMs)
		return () => {
			cancelled = true
			clearInterval(id)
		}
	}, [endpoint, intervalMs, metric, windowMinutes, dataSource])

	const nf = new Intl.NumberFormat(locale)
	const points = toRealtimePoints(series, locale)
	return (
		<>
			<span
				style={{
					fontSize: '2rem',
					fontWeight: 700,
					lineHeight: 1.1,
					color: 'var(--theme-elevation-800)',
				}}
			>
				{nf.format(activeNow)}
			</span>
			<span style={{ fontSize: '0.75rem', color: 'var(--theme-elevation-400)' }}>
				{paused ? pausedLabel : caption}
			</span>
			{sampled && sampledLabel ? (
				<span style={{ fontSize: '0.6875rem', color: 'var(--theme-elevation-400)' }}>
					{sampledLabel}
				</span>
			) : null}
			<TrendChart buckets={points} ariaLabel={caption} minHeight={120} />
		</>
	)
}
