import type { Payload } from 'payload'
import { SEEN_SLUG } from '../collections/seen'
import { bucketKey } from '../rollups/bucketKey'
import { bumpRollups, type RollupBump } from '../rollups/bumpRollups'
import { computeRollupDeltas, type RollupInc, type RollupKey } from '../rollups/deltas'
import { insertManyIfNew } from '../rollups/insertManyIfNew'
import type { StoredEvent } from './normalizeEvent'
import { writeEvent } from './writeEvent'

interface BaseAgg {
	key: RollupKey
	inc: RollupInc
}

interface DistinctCandidate {
	key: RollupKey
	kind: 'visitor' | 'session'
	value: string
}

/**
 * Coalesces a batch of events into the fewest writes: events insert concurrently, base rollup
 * increments are summed per bucket, and distinct visitor / session candidates are de-duplicated
 * within the batch before one insert-if-new decides which of them the ledger had not seen.
 * Whatever the batch size, that is three round trips for the rollups and the ledger rather
 * than one per bucket. Correctness matches the per-event path because the seen ledger still
 * de-dupes across batches, and its unique index still arbitrates between concurrent writers.
 */
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
				for (const metric of Object.keys(agg.inc) as Array<keyof RollupInc>) {
					agg.inc[metric] += delta.inc[metric]
				}
			} else {
				base.set(bk, { key: delta.key, inc: { ...delta.inc } })
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

	await bumpRollups(payload, [...base.values()])

	const pending = [...candidates.values()]
	const isNew = await insertManyIfNew(
		payload,
		SEEN_SLUG,
		pending.map((candidate) => ({
			bucket: bucketKey(candidate.key),
			kind: candidate.kind,
			value: candidate.value,
			period: candidate.key.period,
		}))
	)
	// One increment per ledger row this flush actually created; bumpRollups sums the ones that
	// land on the same bucket.
	const distinct: RollupBump[] = []
	pending.forEach((candidate, index) => {
		if (isNew[index]) {
			distinct.push({
				key: candidate.key,
				inc: candidate.kind === 'visitor' ? { visitors: 1 } : { sessions: 1 },
			})
		}
	})
	await bumpRollups(payload, distinct)
}
