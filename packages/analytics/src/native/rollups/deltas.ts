import { startOfDayInTz } from '../../timeframe/tz'
import type { StoredEvent } from '../ingest/normalizeEvent'

export interface RollupKey {
	granularity: 'day'
	period: Date
	path: string
	dimension: string
	dimvalue: string
	/** '' is the hostname-less bucket family; a real hostname is its own family. */
	hostname: string
	/** Present only in scoped installs, where it is part of the unique bucket. */
	scope?: string
}

export type RollupMetric =
	| 'pageviews'
	| 'events'
	| 'durationMs'
	| 'samples'
	| 'visitors'
	| 'sessions'

export interface RollupDelta {
	key: RollupKey
	inc: { pageviews: number; events: number; durationMs: number; samples: number }
}

/**
 * Distinct metrics (visitors, sessions) are exact per bucket and must never be summed
 * across buckets, so an unfiltered read has to hit its own exact family rather than
 * derive from a hostname-scoped one (or vice versa). Every bucket is therefore emitted
 * twice when a hostname is present: once in the hostname-less ('') family that unfiltered
 * reads use, and once more in the exact-hostname family that a hostname-scoped read uses.
 * Both families stay per-bucket exact at the cost of one extra bucket set per distinct
 * hostname a site sees.
 */
export function computeRollupDeltas(event: StoredEvent): RollupDelta[] {
	// Bucket into the event's reporting-timezone day (UTC when unset), fixing the day
	// boundary at ingest. Existing rollups are not re-bucketed if the timezone changes.
	const period = startOfDayInTz(event.timestamp, event.timezone)
	const inc = {
		pageviews: event.type === 'pageview' ? 1 : 0,
		events: event.type === 'event' ? 1 : 0,
		durationMs: event.durationMs ?? 0,
		samples: 1,
	}
	const make = (
		bucket: [path: string, dimension: string, dimvalue: string],
		hostname: string
	): RollupDelta => ({
		key: {
			granularity: 'day',
			period,
			path: bucket[0],
			dimension: bucket[1],
			dimvalue: bucket[2],
			hostname,
			...(event.scope !== undefined ? { scope: event.scope } : {}),
		},
		inc: { ...inc },
	})
	const buckets: Array<[path: string, dimension: string, dimvalue: string]> = [
		[event.path, '', ''],
		['', '', ''],
	]
	if (event.country) {
		buckets.push(['', 'country', event.country])
	}
	if (event.device) {
		buckets.push(['', 'device', event.device])
	}
	if (event.source) {
		buckets.push(['', 'source', event.source])
	}
	const deltas = buckets.map((bucket) => make(bucket, ''))
	if (event.hostname) {
		deltas.push(...buckets.map((bucket) => make(bucket, event.hostname)))
	}
	return deltas
}
