import type { StoredEvent } from '../ingest/normalizeEvent'

export interface RollupKey {
	granularity: 'day'
	period: Date
	path: string
	dimension: string
	dimvalue: string
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

const startOfUtcDay = (d: Date): Date =>
	new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))

export function computeRollupDeltas(event: StoredEvent): RollupDelta[] {
	return [
		{
			key: {
				granularity: 'day',
				period: startOfUtcDay(event.timestamp),
				path: event.path,
				dimension: '',
				dimvalue: '',
			},
			inc: {
				pageviews: event.type === 'pageview' ? 1 : 0,
				events: event.type === 'event' ? 1 : 0,
				durationMs: event.durationMs ?? 0,
				samples: 1,
			},
		},
	]
}
