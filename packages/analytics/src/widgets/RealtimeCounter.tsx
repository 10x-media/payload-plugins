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
	locale: string
	caption: string
	pausedLabel: string
}

export function RealtimeCounter(props: RealtimeCounterProps) {
	const { endpoint, intervalMs, metric, windowMinutes, dataSource, locale, caption, pausedLabel } =
		props
	const [activeNow, setActiveNow] = useState(props.initialActiveNow)
	const [series, setSeries] = useState(props.initialSeries)
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
				}
				if (cancelled || data.status !== 'ok') return
				setActiveNow(data.activeNow)
				setSeries(data.series)
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
			<TrendChart buckets={points} ariaLabel={caption} minHeight={120} />
		</>
	)
}
