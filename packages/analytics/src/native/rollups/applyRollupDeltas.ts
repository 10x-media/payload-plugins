import type { Payload } from 'payload'
import { bumpRollup } from './bumpRollup'
import type { RollupDelta } from './deltas'

/**
 * One upsert per bucket. Superseded on the write path by the batched `bumpRollups`, and kept
 * as the serial reference the matrix parity test replays a whole flush through before
 * comparing the two row for row.
 */
export async function applyRollupDeltas(payload: Payload, deltas: RollupDelta[]): Promise<void> {
	for (const d of deltas) {
		await bumpRollup(payload, d.key, d.inc)
	}
}
