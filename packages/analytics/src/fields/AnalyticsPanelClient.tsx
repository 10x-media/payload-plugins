'use client'

import { ReactSelect, useConfig, useDocumentInfo } from '@payloadcms/ui'
import { type CSSProperties, useCallback, useState } from 'react'
import { bucketSeries } from '../charts/bucket'
import { TrendChart } from '../charts/TrendChart'
import type { MetricKey } from '../core/contract'
import { DOCUMENT_PATH } from '../plugin/paths'
import { TIMEFRAME_PRESETS, type TimeframePreset } from '../timeframe/presets'
import { keys, type TranslationKey } from '../translations/keys'
import { METRIC_KEYS, TIMEFRAME_KEYS } from '../translations/metricKeys'
import { useTranslation } from '../translations/useTranslation'
import { ComparisonDelta } from '../widgets/ComparisonDelta'
import type { SeriesPoint } from '../widgets/readForWidgetSeries'
import { AnalyticsEmptyState, isNewDocumentAnalytics } from './emptyState'
import { formatMetricValue } from './format'
import type { FieldReadStatus } from './readForDocument'

/** JSON-safe shape of a document analytics read, as the panel endpoint returns it. */
export interface PanelData {
	status: FieldReadStatus
	metrics: Partial<Record<MetricKey, number>>
	supportedMetrics: MetricKey[]
	previousMetrics?: Partial<Record<MetricKey, number>>
	comparisonRange?: { start: string; end: string } | null
	/** Reporting timezone the read resolved in; the trend axis buckets in it. */
	timezone?: string
	points?: SeriesPoint[]
}

export interface AnalyticsPanelClientProps {
	collectionSlug: string
	metrics: MetricKey[]
	initial: PanelData
	initialTimeframe: TimeframePreset
	adapterId?: string
	/** Metric card labels resolved to plain strings on the server. */
	labels?: Partial<Record<MetricKey, string>>
}

const STATE_KEYS: Record<Exclude<FieldReadStatus, 'ok'>, TranslationKey> = {
	'no-path': keys.stateNoData,
	'not-bound': keys.stateNotBound,
	'not-configured': keys.stateNotConfigured,
	unavailable: keys.stateUnavailable,
}

const cardStyle: CSSProperties = {
	display: 'flex',
	flexDirection: 'column',
	gap: '0.25rem',
	minWidth: '7rem',
}
const labelStyle: CSSProperties = {
	fontSize: '0.6875rem',
	fontWeight: 600,
	letterSpacing: '0.04em',
	textTransform: 'uppercase',
	color: 'var(--theme-elevation-500)',
}
const valueStyle: CSSProperties = { fontSize: '1.5rem', fontWeight: 600, lineHeight: 1.1 }

/**
 * Interactive per-document analytics panel: metric cards with period-over-period
 * deltas, a daily trend for the first metric, and a timeframe picker that refetches
 * through the authenticated document endpoint. The server component provides the
 * initial read so first paint never flashes empty.
 */
export function AnalyticsPanelClient(props: AnalyticsPanelClientProps) {
	const { collectionSlug, metrics, initial, initialTimeframe, adapterId, labels } = props
	const { t, i18n } = useTranslation()
	const locale = i18n.language ?? 'en-US'
	const { id } = useDocumentInfo()
	const {
		config: {
			routes: { api },
			serverURL,
		},
	} = useConfig()
	const [timeframe, setTimeframe] = useState<TimeframePreset>(initialTimeframe)
	const [data, setData] = useState<PanelData>(initial)
	const [loading, setLoading] = useState(false)

	const refetch = useCallback(
		async (preset: TimeframePreset) => {
			if (id === undefined || id === null) {
				return
			}
			setLoading(true)
			try {
				const params = new URLSearchParams({
					collection: collectionSlug,
					id: String(id),
					timeframe: preset,
					metrics: metrics.join(','),
					compare: '1',
					series: '1',
				})
				if (adapterId) {
					params.set('dataSource', adapterId)
				}
				const res = await fetch(`${serverURL ?? ''}${api}${DOCUMENT_PATH}?${params}`, {
					credentials: 'include',
				})
				if (!res.ok) {
					throw new Error(`analytics document read failed: ${res.status}`)
				}
				setData((await res.json()) as PanelData)
			} catch {
				setData((prev) => ({ ...prev, status: 'unavailable' }))
			} finally {
				setLoading(false)
			}
		},
		[adapterId, api, collectionSlug, id, metrics, serverURL]
	)

	const onTimeframeChange = (preset: TimeframePreset) => {
		setTimeframe(preset)
		void refetch(preset)
	}

	const timeframeOptions = TIMEFRAME_PRESETS.map((p) => ({
		value: p,
		label: t(TIMEFRAME_KEYS[p]),
	}))
	const firstMetric = data.supportedMetrics[0]
	const buckets =
		data.points && data.points.length > 0 && firstMetric
			? bucketSeries(data.points, timeframe, data.timezone).map((b) => ({
					...b,
					display: formatMetricValue(firstMetric, b.value, locale),
				}))
			: null

	return (
		<div
			className="field-type analytics-panel"
			style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
		>
			<div style={{ display: 'flex', justifyContent: 'flex-end' }}>
				<div style={{ minWidth: '11rem' }}>
					<ReactSelect
						isClearable={false}
						isSearchable={false}
						value={{ value: timeframe, label: t(TIMEFRAME_KEYS[timeframe]) }}
						options={timeframeOptions}
						onChange={(option) => {
							const value = (option as { value?: TimeframePreset } | null)?.value
							if (value && value !== timeframe) {
								onTimeframeChange(value)
							}
						}}
					/>
				</div>
			</div>
			<div style={{ opacity: loading ? 0.5 : 1, transition: 'opacity 0.15s' }}>
				{isNewDocumentAnalytics(data) ? (
					<AnalyticsEmptyState isNew label={t(keys.stateNew)} />
				) : data.status !== 'ok' ? (
					<AnalyticsEmptyState isNew={false} label={t(STATE_KEYS[data.status])} />
				) : (
					<div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
						<div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem' }}>
							{data.supportedMetrics.map((metric) => (
								<div key={metric} style={cardStyle}>
									<span style={labelStyle}>{labels?.[metric] ?? t(METRIC_KEYS[metric])}</span>
									<span style={valueStyle}>
										{formatMetricValue(metric, data.metrics[metric] ?? 0, locale)}
									</span>
									{data.comparisonRange ? (
										<ComparisonDelta
											current={data.metrics[metric] ?? 0}
											previous={data.previousMetrics?.[metric]}
											metric={metric}
											locale={locale}
											t={t}
										/>
									) : null}
								</div>
							))}
						</div>
						{buckets && firstMetric ? (
							<TrendChart
								buckets={buckets}
								ariaLabel={`${t(METRIC_KEYS[firstMetric])} ${t(TIMEFRAME_KEYS[timeframe])}`}
								minHeight={140}
							/>
						) : null}
						<span style={{ fontSize: '0.75rem', color: 'var(--theme-elevation-400)' }}>
							{t(TIMEFRAME_KEYS[timeframe])}
						</span>
					</div>
				)}
			</div>
		</div>
	)
}
