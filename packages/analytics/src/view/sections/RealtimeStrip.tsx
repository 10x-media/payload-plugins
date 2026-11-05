'use client'

import { Button } from '@payloadcms/ui'
import { type ReactNode, useId } from 'react'
import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { Card } from '../../ui/components/Card'
import { useRealtimePoll } from '../../ui/hooks/useRealtimePoll'
import { RealtimeReadout } from '../../widgets/RealtimeCounter'
import { buildPollPath } from '../../widgets/realtimePoll'
import { RetryAfter, Skeleton } from './EmptyStates'

export interface RealtimeStripProps {
	/** The live endpoint's URL, relative: this only ever runs in the admin's own browser. */
	endpoint: string
	/** The resolved source; the endpoint reads it as the adapter id. */
	sourceId: string
	locale: string
	/** Reporting timezone the counter's minute labels read in. */
	timezone: string
	/** The scope the view is reading; the endpoint refuses one this caller may not read. */
	scope?: string
}

const WINDOW_MINUTES = 30
const POLL_MS = 15_000

/** The readout's height, its number line over its sparkline, so the first reading moves nothing. */
const REALTIME_READOUT_HEIGHT = 156

/**
 * Visitors in the last half hour, polled. A placeholder until the first reading lands; with none,
 * a busy source says so and offers a retry, a source counting no one live says it is unavailable.
 */
export function RealtimeStrip({ endpoint, sourceId, locale, timezone, scope }: RealtimeStripProps) {
	const { t } = useTranslation()
	const headingId = useId()
	const url = buildPollPath(endpoint, {
		metric: 'visitors',
		windowMinutes: WINDOW_MINUTES,
		dataSource: sourceId,
		...(scope === undefined ? {} : { scope }),
	})
	const { reading, paused, settled, busy, retry } = useRealtimePoll({ url, intervalMs: POLL_MS })

	const body = (): ReactNode => {
		if (reading !== null) {
			return (
				<RealtimeReadout
					label={t(keys.metricVisitors)}
					locale={locale}
					phrase="liveVisitors"
					windowMinutes={WINDOW_MINUTES}
					paused={paused}
					pausedLabel={t(keys.widgetRealtimePaused)}
					periodLabel={t(keys.viewTrendPeriod)}
					reading={reading}
					sampledLabel={t(keys.stateSampled)}
					timezone={timezone}
				/>
			)
		}
		if (!settled) {
			return <Skeleton height={REALTIME_READOUT_HEIGHT} rows={1} variant="chart" />
		}
		if (!busy) {
			return <span className="analytics-view__empty">{t(keys.stateUnavailable)}</span>
		}
		return (
			<div className="analytics-state analytics-state--start" role="status">
				<span className="analytics-view__empty">{t(keys.viewErrorBusy)}</span>
				<RetryAfter className="analytics-state__after" seconds={busy.retryAfter} />
				<Button buttonStyle="secondary" margin={false} onClick={retry} size="small">
					{t(keys.viewRetry)}
				</Button>
			</div>
		)
	}

	return (
		<Card aria-labelledby={headingId} as="section" className="analytics-view__panel">
			<h2 className="analytics-view__label analytics-view__heading" id={headingId}>
				{t(keys.widgetRealtimeLabel)}
			</h2>
			{body()}
		</Card>
	)
}
