import type { AnalyticsCapabilities, Granularity } from './contract'

export const GRANULARITY_ORDER: Granularity[] = ['minute', 'hour', 'day', 'week', 'month']

/**
 * Whether an adapter can bucket at granularity `g`. `minGranularity` is the finest
 * bucket a provider supports, so it also supports every coarser one.
 */
export const supportsGranularity = (caps: AnalyticsCapabilities, g: Granularity): boolean =>
	GRANULARITY_ORDER.indexOf(g) >= GRANULARITY_ORDER.indexOf(caps.minGranularity)
