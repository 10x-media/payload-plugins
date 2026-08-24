import type { AnalyticsCapabilities, DimensionKey, Granularity, MetricKey } from './contract'

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

/** Wire form of AnalyticsCapabilities for client pickers: a deliberate allowlist, so adapter internals (rate limits, TTLs) never become client contract by accident. */
export type SerializedCapabilities = {
	metrics: MetricKey[]
	dimensions: DimensionKey[]
	realtime: boolean
	realtimeWindowMinutes?: number
	perPageQuery: boolean
	comparison: boolean
	minGranularity: Granularity
	maxLookbackDays: number | null
}

export const serializeCapabilities = (caps: AnalyticsCapabilities): SerializedCapabilities => ({
	metrics: [...caps.metrics],
	dimensions: [...caps.dimensions],
	realtime: caps.realtime,
	...(caps.realtimeWindowMinutes !== undefined
		? { realtimeWindowMinutes: caps.realtimeWindowMinutes }
		: {}),
	perPageQuery: caps.perPageQuery,
	comparison: caps.comparison,
	minGranularity: caps.minGranularity,
	maxLookbackDays: caps.maxLookbackDays,
})
