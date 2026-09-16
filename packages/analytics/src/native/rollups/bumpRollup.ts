import type { Payload } from 'payload'
import { bumpRollups } from './bumpRollups'
import type { RollupKey, RollupMetric } from './deltas'

/** One bucket's increment. The batched sibling is what a flush uses; this is the single-shot form. */
export async function bumpRollup(
	payload: Payload,
	key: RollupKey,
	inc: Partial<Record<RollupMetric, number>>
): Promise<void> {
	await bumpRollups(payload, [{ key, inc }])
}
