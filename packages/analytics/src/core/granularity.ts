import type { AnalyticsCapabilities, Granularity } from './contract'

/** Every bucket, finest first. */
export const GRANULARITY_ORDER: Granularity[] = ['minute', 'hour', 'day', 'week', 'month']

/**
 * Whether a source buckets at `g`: `minGranularity` is the finest bucket it supports, so it supports
 * every coarser one too.
 */
export const supportsGranularity = (
	caps: Pick<AnalyticsCapabilities, 'minGranularity'>,
	g: Granularity
): boolean => GRANULARITY_ORDER.indexOf(g) >= GRANULARITY_ORDER.indexOf(caps.minGranularity)
