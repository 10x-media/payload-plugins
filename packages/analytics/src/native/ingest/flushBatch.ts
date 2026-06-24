import type { Payload } from 'payload'
import { SEEN_SLUG } from '../collections/seen'
import { bucketKey } from '../rollups/applyDistinctDeltas'
import { bumpRollup } from '../rollups/bumpRollup'
import { computeRollupDeltas, type RollupKey, type RollupMetric } from '../rollups/deltas'
import { insertIfNew } from '../rollups/insertIfNew'
import type { StoredEvent } from './normalizeEvent'
import { writeEvent } from './writeEvent'

interface BaseAgg {
	key: RollupKey
	pageviews: number
	events: number
	durationMs: number
	samples: number
}

interface DistinctCandidate {
	key: RollupKey
	kind: 'visitor' | 'session'
	value: string
}

// Coalesces a batch of events into the fewest writes: events insert concurrently, base
// rollup increments are summed per bucket into one upsert each, and distinct visitor /
// session candidates are de-duplicated within the batch before insert-if-new. Correctness
// matches the per-event path because the seen ledger still de-dupes across batches.
export async function flushBatch(payload: Payload, events: StoredEvent[]): Promise<void> {
	if (events.length === 0) {
		return
	}
	await Promise.all(events.map((event) => writeEvent(payload, event)))

	const base = new Map<string, BaseAgg>()
	const candidates = new Map<string, DistinctCandidate>()
	for (const event of events) {
		for (const delta of computeRollupDeltas(event)) {
			const bk = bucketKey(delta.key)
			const agg = base.get(bk)
			if (agg) {
				agg.pageviews += delta.inc.pageviews
				agg.events += delta.inc.events
				agg.durationMs += delta.inc.durationMs
				agg.samples += delta.inc.samples
			} else {
				base.set(bk, { key: delta.key, ...delta.inc })
			}
			candidates.set(`${bk}|visitor|${event.visitorHash}`, {
				key: delta.key,
				kind: 'visitor',
				value: event.visitorHash,
			})
			candidates.set(`${bk}|session|${event.sessionId}`, {
				key: delta.key,
				kind: 'session',
				value: event.sessionId,
			})
		}
	}

	for (const agg of base.values()) {
		await bumpRollup(payload, agg.key, {
			pageviews: agg.pageviews,
			events: agg.events,
			durationMs: agg.durationMs,
			samples: agg.samples,
		})
	}

	const distinct = new Map<string, { key: RollupKey; metric: RollupMetric; count: number }>()
	for (const candidate of candidates.values()) {
		const isNew = await insertIfNew(payload, SEEN_SLUG, {
			bucket: bucketKey(candidate.key),
			kind: candidate.kind,
			value: candidate.value,
			period: candidate.key.period,
		})
		if (!isNew) {
			continue
		}
		const metric: RollupMetric = candidate.kind === 'visitor' ? 'visitors' : 'sessions'
		const dk = `${bucketKey(candidate.key)}|${metric}`
		const entry = distinct.get(dk)
		if (entry) {
			entry.count += 1
		} else {
			distinct.set(dk, { key: candidate.key, metric, count: 1 })
		}
	}

	for (const entry of distinct.values()) {
		const inc: Partial<Record<RollupMetric, number>> = {}
		inc[entry.metric] = entry.count
		await bumpRollup(payload, entry.key, inc)
	}
}
