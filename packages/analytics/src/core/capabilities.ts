import type { AnalyticsCapabilities, DimensionKey, MetricKey } from './contract'

export interface CapabilityRequirement {
	metrics?: MetricKey[]
	dimensions?: DimensionKey[]
	realtime?: boolean
	perPageQuery?: boolean
}

export function satisfiesCapabilities(
	caps: AnalyticsCapabilities,
	req: CapabilityRequirement
): boolean {
	if (req.realtime && !caps.realtime) return false
	if (req.perPageQuery && !caps.perPageQuery) return false
	if (req.metrics?.some((m) => !caps.metrics.has(m))) return false
	if (req.dimensions?.some((d) => !caps.dimensions.has(d))) return false
	return true
}

/** Wire form of AnalyticsCapabilities: the read-only Sets become plain arrays so the sources endpoint can JSON-serialize them for client pickers. */
export type SerializedCapabilities = Omit<AnalyticsCapabilities, 'metrics' | 'dimensions'> & {
	metrics: MetricKey[]
	dimensions: DimensionKey[]
}

export const serializeCapabilities = (caps: AnalyticsCapabilities): SerializedCapabilities => ({
	...caps,
	metrics: [...caps.metrics],
	dimensions: [...caps.dimensions],
})
