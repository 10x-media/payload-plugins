import type { Payload } from 'payload'
import { bumpRollup } from './bumpRollup'
import type { RollupDelta } from './deltas'

/**
 * One round trip per bucket, through `bumpRollup`, which is a one-bump call to the same
 * batched `bumpRollups` statement. So the parity test the matrix suite replays a flush through
 * is not checking two upsert implementations against each other: it checks what `flushBatch`
 * puts around this one, its coalescing of a whole batch into one statement, against the
 * bucket-at-a-time loop kept here.
 */
export async function applyRollupDeltas(payload: Payload, deltas: RollupDelta[]): Promise<void> {
	for (const d of deltas) {
		await bumpRollup(payload, d.key, d.inc)
	}
}
