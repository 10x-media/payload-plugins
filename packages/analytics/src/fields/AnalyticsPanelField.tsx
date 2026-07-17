import type { PayloadRequest } from 'payload'
import type { BindingDoc } from '../binding/types'
import type { MetricKey } from '../core/contract'
import type { TimeframePreset } from '../timeframe/presets'
import { METRIC_KEYS } from '../translations/metricKeys'
import { asTranslate } from '../translations/server'
import type { PanelData } from './AnalyticsPanelClient'
import { resolveMetricLabel, type StatFieldI18n } from './AnalyticsStatField'
import type { AnalyticsMetricLabels } from './factories'
import { readForField } from './readForDocument'

interface AnalyticsPanelFieldProps {
	req: PayloadRequest
	data: BindingDoc
	collectionSlug: string
	i18n: StatFieldI18n
	metrics: MetricKey[]
	timeframe: TimeframePreset
	adapterId?: string
	labels?: AnalyticsMetricLabels
}

/**
 * Server entry for the interactive document analytics panel: performs the initial
 * read (with comparison and daily series) so the client renders populated, resolves
 * metric label overrides to plain strings, and hands off to the client panel for
 * timeframe interactivity.
 */
export const AnalyticsPanelField = async (props: AnalyticsPanelFieldProps) => {
	const { req, data, collectionSlug, i18n, metrics, timeframe, adapterId, labels } = props
	const t = asTranslate(i18n.t)
	// Imported lazily so the /rsc export surface stays loadable outside a bundler
	// (plain-node scripts and workers); the client module's @payloadcms/ui chain
	// includes CSS only a bundler can resolve.
	const { AnalyticsPanelClient } = await import('./AnalyticsPanelClient')

	const result = await readForField({
		req,
		collectionSlug,
		data,
		metrics,
		timeframe,
		adapterId,
		now: new Date(),
		compare: true,
		series: true,
	})

	const initial: PanelData = {
		status: result.status,
		metrics: result.metrics,
		supportedMetrics: result.supportedMetrics,
		previousMetrics: result.previousMetrics,
		comparisonRange: result.comparisonRange
			? {
					start: result.comparisonRange.start.toISOString(),
					end: result.comparisonRange.end.toISOString(),
				}
			: undefined,
		points: result.points,
	}
	const resolvedLabels: Partial<Record<MetricKey, string>> = {}
	for (const metric of metrics) {
		resolvedLabels[metric] = resolveMetricLabel(labels?.[metric], i18n, () =>
			t(METRIC_KEYS[metric])
		)
	}

	return (
		<AnalyticsPanelClient
			collectionSlug={collectionSlug}
			metrics={metrics}
			initial={initial}
			initialTimeframe={timeframe}
			adapterId={adapterId}
			labels={resolvedLabels}
		/>
	)
}
