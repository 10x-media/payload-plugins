import type { Payload } from 'payload'
import { SEEN_SLUG } from '../collections/seen'
import type { StoredEvent } from '../ingest/normalizeEvent'
import { bumpRollup } from './bumpRollup'
import type { RollupDelta, RollupKey } from './deltas'
import { insertIfNew } from './insertIfNew'

export function bucketKey(key: RollupKey): string {
	const base = `${key.granularity}|${key.period.toISOString()}|${key.path}|${key.dimension}|${key.dimvalue}|${key.hostname}`
	return key.scope !== undefined ? `${base}|${key.scope}` : base
}

// For each rollup bucket the event touches, count this visitor and session at most once.
// insertIfNew is the dedup gate; only a genuinely new ledger row bumps the distinct counter.
export async function applyDistinctDeltas(
	payload: Payload,
	event: StoredEvent,
	deltas: RollupDelta[]
): Promise<void> {
	for (const d of deltas) {
		const bucket = bucketKey(d.key)
		const period = d.key.period
		if (
			await insertIfNew(payload, SEEN_SLUG, {
				bucket,
				kind: 'visitor',
				value: event.visitorHash,
				period,
			})
		) {
			await bumpRollup(payload, d.key, { visitors: 1 })
		}
		if (
			await insertIfNew(payload, SEEN_SLUG, {
				bucket,
				kind: 'session',
				value: event.sessionId,
				period,
			})
		) {
			await bumpRollup(payload, d.key, { sessions: 1 })
		}
	}
}
