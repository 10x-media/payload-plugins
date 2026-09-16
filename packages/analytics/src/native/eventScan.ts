import type { AnalyticsResult } from '../core/contract'

/**
 * Hard cap on how many raw events a single read scans. Reads that cannot use the day
 * bucketed rollups (filtered, hour granularity, realtime) walk events newest-first under
 * this cap, so a very busy site keeps its most recent activity rather than its oldest.
 */
export const EVENT_SCAN_LIMIT = 50_000

export interface EventScanMetaArgs {
	fetchedAt: string
	/** How many events the capped scan came back with. */
	eventCount: number
	clamped?: boolean
	limit?: number
}

/**
 * Meta for a read that aggregated raw events under the scan cap. A scan that came back
 * full almost certainly left events behind, so its numbers are a floor rather than a
 * count and `sampled` tells every surface to say so.
 */
export const eventScanMeta = (args: EventScanMetaArgs): AnalyticsResult['meta'] => {
	const meta: AnalyticsResult['meta'] = { provider: 'native', fetchedAt: args.fetchedAt }
	if (args.clamped) {
		meta.clamped = true
	}
	if (args.eventCount >= (args.limit ?? EVENT_SCAN_LIMIT)) {
		meta.sampled = true
	}
	return meta
}
