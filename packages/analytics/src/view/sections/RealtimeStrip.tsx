'use client'

import { useEffect, useState } from 'react'
import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { RealtimeCounter } from '../../widgets/RealtimeCounter'
import type { RealtimePoint } from '../../widgets/readForWidgetRealtime'
import { buildPollPath, buildRealtimeEndpoint } from '../../widgets/realtimePoll'
import { Skeleton } from './EmptyStates'

export interface RealtimeStripProps {
	apiRoute: string
	/** The resolved source; the endpoint reads it as the adapter id. */
	sourceId: string
	locale: string
}

const WINDOW_MINUTES = 30
const POLL_MS = 15_000

interface Reading {
	activeNow: number
	series: RealtimePoint[]
}

type FirstRead = { status: 'loading' } | { status: 'ok'; reading: Reading } | { status: 'error' }

/**
 * Visitors in the last half hour, polled. The counter needs a first reading to mount with
 * (it is server-rendered in the widget), so the strip takes one itself and hands it over;
 * the counter keeps it fresh from then on. A relative endpoint is correct here: this only
 * ever runs in the admin's own browser.
 */
export function RealtimeStrip({ apiRoute, sourceId, locale }: RealtimeStripProps) {
	const { t } = useTranslation()
	const [first, setFirst] = useState<FirstRead>({ status: 'loading' })
	const endpoint = buildRealtimeEndpoint(undefined, apiRoute)

	useEffect(() => {
		const controller = new AbortController()
		const path = buildPollPath(endpoint, {
			metric: 'visitors',
			windowMinutes: WINDOW_MINUTES,
			dataSource: sourceId,
		})
		setFirst({ status: 'loading' })
		fetch(path, { credentials: 'same-origin', signal: controller.signal })
			.then((res) => (res.ok ? res.json() : null))
			.then((data: { status?: string; activeNow?: number; series?: RealtimePoint[] } | null) => {
				if (controller.signal.aborted) {
					return
				}
				setFirst(
					data?.status === 'ok'
						? {
								status: 'ok',
								reading: { activeNow: data.activeNow ?? 0, series: data.series ?? [] },
							}
						: { status: 'error' }
				)
			})
			.catch(() => {
				// A refused or unreachable first read says so, rather than pulsing forever:
				// without a reading the counter has nothing to mount with and never polls.
				if (!controller.signal.aborted) {
					setFirst({ status: 'error' })
				}
			})
		return () => {
			controller.abort()
		}
	}, [endpoint, sourceId])

	return (
		<section className="analytics-view__panel">
			<span className="analytics-view__label">{t(keys.widgetRealtimeLabel)}</span>
			{first.status === 'loading' ? (
				<Skeleton rows={1} variant="chart" />
			) : first.status === 'error' ? (
				<span className="analytics-view__empty">{t(keys.stateUnavailable)}</span>
			) : (
				<RealtimeCounter
					caption={t(keys.widgetRealtimeCaption)}
					dataSource={sourceId}
					endpoint={endpoint}
					initialActiveNow={first.reading.activeNow}
					initialSeries={first.reading.series}
					intervalMs={POLL_MS}
					key={sourceId}
					locale={locale}
					metric="visitors"
					pausedLabel={t(keys.widgetRealtimePaused)}
					windowMinutes={WINDOW_MINUTES}
				/>
			)}
		</section>
	)
}
