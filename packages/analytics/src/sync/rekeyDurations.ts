import type { Payload } from 'payload'
import { isCollectionSlug } from '../core/collectionSlug'
import { TASK_SLUGS } from '../core/jobs'
import { DETACHED } from '../db/openTransaction'
import type { StateStore } from '../native/store/types'

/** Where the state store keeps how far the move got: the cutoff instant, then `done`. */
export const REKEY_CURSOR = `${TASK_SLUGS.sync}:durations`

const DONE = 'done'

/**
 * Built-in vendors whose `avgDuration` held time per visit until 1.0.0-beta.12, matched as a config
 * adapter id or a provider document's `<provider>:<id>`.
 */
const PER_VISIT_VENDORS: ReadonlySet<string> = new Set(['ga4', 'plausible', 'umami'])

const storedTimePerVisit = (source: string): boolean =>
	PER_VISIT_VENDORS.has(source.split(':')[0] ?? source)

export interface RekeyArgs {
	payload: Payload
	collectionSlug: string
	state: Pick<StateStore, 'cursor' | 'setCursor'>
	now: Date
	/** Whether the run may go on; checked before every row. */
	going: () => boolean
}

export interface RekeyOutcome {
	moved: number
	/** False when the run stopped before every row was moved; the next run carries on. */
	finished: boolean
}

/**
 * Moves time per visit from a vendor row's `avgDuration` (now time on page) to `visitDuration`, for
 * rows whose `syncedAt` predates this version's first run, which the state store keeps.
 */
export const rekeySyncedDurations = async (args: RekeyArgs): Promise<RekeyOutcome> => {
	const { payload, collectionSlug, state } = args
	const cursor = await state.cursor(REKEY_CURSOR)
	if (cursor === DONE || !isCollectionSlug(payload, collectionSlug)) {
		return { moved: 0, finished: true }
	}
	const cutoff = cursor ?? args.now.toISOString()
	if (cursor === null) {
		await state.setCursor(REKEY_CURSOR, cutoff)
	}
	const { docs } = await payload.db.find<Record<string, unknown>>({
		collection: collectionSlug,
		where: {
			and: [{ syncedAt: { less_than: cutoff } }, { avgDuration: { greater_than_equal: 0 } }],
		},
		pagination: false,
		select: { source: true, avgDuration: true },
		req: DETACHED,
	})
	let moved = 0
	for (const doc of docs) {
		if (!args.going()) {
			return { moved, finished: false }
		}
		const { id, source, avgDuration: duration } = doc
		if (
			(typeof id !== 'string' && typeof id !== 'number') ||
			typeof source !== 'string' ||
			typeof duration !== 'number' ||
			!storedTimePerVisit(source)
		) {
			continue
		}
		await payload.db.updateOne({
			collection: collectionSlug,
			id,
			data: { visitDuration: duration, avgDuration: null },
			req: DETACHED,
			returning: false,
		})
		moved++
	}
	await state.setCursor(REKEY_CURSOR, DONE)
	return { moved, finished: true }
}
