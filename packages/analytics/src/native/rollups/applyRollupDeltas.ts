import type { Payload } from 'payload'
import { bumpRollup } from './bumpRollup'
import type { RollupDelta } from './deltas'

export async function applyRollupDeltas(payload: Payload, deltas: RollupDelta[]): Promise<void> {
	for (const d of deltas) {
		await bumpRollup(payload, d.key, d.inc)
	}
}
