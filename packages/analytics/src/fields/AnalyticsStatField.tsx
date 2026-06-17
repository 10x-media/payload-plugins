import type { PayloadRequest } from 'payload'
import type { CSSProperties } from 'react'
import type { BindingDoc } from '../binding/types'
import type { MetricKey } from '../core/contract'
import type { TimeframePreset } from '../timeframe/presets'
import { keys, type TranslationKey } from '../translations/keys'
import { asTranslate } from '../translations/server'
import { formatMetricValue } from './format'
import { type FieldReadStatus, readForField } from './readForDocument'

interface AnalyticsStatFieldProps {
	req: PayloadRequest
	data: BindingDoc
	collectionSlug: string
	i18n: { t: unknown; language?: string }
	metrics: MetricKey[]
	timeframe: TimeframePreset
	variant: 'stat' | 'row'
	adapterId?: string
}

const METRIC_KEYS: Record<MetricKey, TranslationKey> = {
	pageviews: keys.metricPageviews,
	visitors: keys.metricVisitors,
	visits: keys.metricVisitors,
	sessions: keys.metricSessions,
	events: keys.metricEvents,
	avgDuration: keys.metricAvgDuration,
	bounceRate: keys.metricBounceRate,
	entries: keys.metricEntries,
	exits: keys.metricExits,
	scrollDepth: keys.metricScrollDepth,
	conversions: keys.metricConversions,
	revenue: keys.metricRevenue,
}

const STATE_KEYS: Record<Exclude<FieldReadStatus, 'ok'>, TranslationKey> = {
	'no-path': keys.stateNoData,
	'not-bound': keys.stateNotBound,
	'not-configured': keys.stateNotConfigured,
	unavailable: keys.stateUnavailable,
}

const TIMEFRAME_KEYS: Record<TimeframePreset, TranslationKey> = {
	today: keys.timeframeToday,
	last7days: keys.timeframeLast7Days,
	last30days: keys.timeframeLast30Days,
	last90days: keys.timeframeLast90Days,
	thisMonth: keys.timeframeThisMonth,
	thisYear: keys.timeframeThisYear,
}

const wrapStyle: CSSProperties = {
	display: 'flex',
	flexWrap: 'wrap',
	gap: 'var(--base, 1rem)',
	alignItems: 'flex-end',
}
const cardStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.25rem' }
const labelStyle: CSSProperties = { fontSize: '0.75rem', opacity: 0.6, textTransform: 'uppercase' }
const valueStyle: CSSProperties = { fontSize: '1.5rem', fontWeight: 600, lineHeight: 1.1 }
const captionStyle: CSSProperties = { fontSize: '0.75rem', opacity: 0.5, width: '100%' }

/**
 * Read-only server component for a per-document analytics stat (or row of stats).
 * Resolves the document's bound path, reads through the surfacing engine, and renders
 * static markup. Interactivity (timeframe picker, refresh) is intentionally deferred.
 */
export const AnalyticsStatField = async (props: AnalyticsStatFieldProps) => {
	const { req, data, collectionSlug, i18n, metrics, timeframe, adapterId } = props
	const t = asTranslate(i18n.t)
	const locale = i18n.language ?? 'en-US'

	const result = await readForField({
		req,
		collectionSlug,
		data,
		metrics,
		timeframe,
		adapterId,
		now: new Date(),
	})

	if (result.status !== 'ok') {
		return (
			<div className="field-type" style={{ opacity: 0.6 }}>
				{t(STATE_KEYS[result.status])}
			</div>
		)
	}

	return (
		<div className="field-type" style={wrapStyle}>
			{metrics.map((metric) => (
				<div key={metric} style={cardStyle}>
					<span style={labelStyle}>{t(METRIC_KEYS[metric])}</span>
					<span style={valueStyle}>
						{formatMetricValue(metric, result.metrics[metric] ?? 0, locale)}
					</span>
				</div>
			))}
			<span style={captionStyle}>{t(TIMEFRAME_KEYS[timeframe])}</span>
		</div>
	)
}
