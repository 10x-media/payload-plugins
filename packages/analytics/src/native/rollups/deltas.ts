import { startOfDayInTz } from '../../timeframe/tz'
import type { StoredEvent } from '../ingest/normalizeEvent'

export interface RollupKey {
	granularity: 'day'
	period: Date
	path: string
	dimension: string
	dimvalue: string
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
	const make = (path: string, dimension: string, dimvalue: string): RollupDelta => ({
		key: {
			granularity: 'day',
			period,
			path,
			dimension,
			dimvalue,
			...(event.scope !== undefined ? { scope: event.scope } : {}),
		},
		inc: { ...inc },
	})
	const deltas: RollupDelta[] = [make(event.path, '', ''), make('', '', '')]
	if (event.country) {
		deltas.push(make('', 'country', event.country))
	}
	if (event.device) {
		deltas.push(make('', 'device', event.device))
	}
	if (event.source) {
		deltas.push(make('', 'source', event.source))
	}
	return deltas
}
