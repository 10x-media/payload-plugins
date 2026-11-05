import type { CollectionSlug, Payload, Where } from 'payload'
import { currentDate } from '../core/clock'
import { isCollectionSlug } from '../core/collectionSlug'
import { DETACHED } from '../db/openTransaction'
import { dateOf } from '../native/store/columnValues'
import {
	atOf,
	cursorKey,
	cursorOf,
	heartbeatKey,
	leaseTtl,
	type StateKind,
	stateKindOf,
} from '../native/store/state'
import type { StateStoreOptions, TaskStateStore } from '../native/store/types'

type Row = Record<string, unknown>

/** The row of one slot of a lease: `lease:analytics-sync@<slot>`, a slot being one lease period. */
const slotId = (key: string, slot: number): string => `${key}@${slot}`

/**
 * Task state on Payload's database API alone (Cloudflare D1): with no conditional update, a lease
 * is held by inserting one row per period slot, so all claimers of a lease must pass one period.
 */
export const apiTaskState = (
	payload: Payload,
	options: StateStoreOptions & { slug: string }
): TaskStateStore => {
	const now = options.now ?? currentDate
	const collection = (): CollectionSlug => {
		if (!isCollectionSlug(payload, options.slug)) {
			throw new Error(`analytics: the "${options.slug}" collection is not registered`)
		}
		return options.slug
	}

	const rows = async (where: Where, limit = 0): Promise<Row[]> => {
		const { docs } = await payload.db.find<Row>({
			collection: collection(),
			where,
			limit,
			pagination: false,
			req: DETACHED,
		})
		return docs
	}

	const rowOf = async (id: string): Promise<Row | undefined> =>
		(await rows({ id: { equals: id } }, 1))[0]

	/** Inserts a row; false when the id was already taken, by whichever writer got there first. */
	const insert = async (id: string, data: Row): Promise<boolean> => {
		try {
			await payload.db.create({
				collection: collection(),
				data: { ...data, id },
				req: DETACHED,
				returning: false,
			})
			return true
		} catch (err) {
			if ((await rowOf(id)) === undefined) {
				throw err
			}
			return false
		}
	}

	/** Writes a keyed row's value, creating the row on its first write. */
	const put = async (id: string, kind: StateKind, value: Row): Promise<void> => {
		const update = () =>
			payload.db.updateOne({
				collection: collection(),
				id,
				data: { value },
				req: DETACHED,
				returning: false,
			})
		if ((await rowOf(id)) !== undefined) {
			await update()
			return
		}
		if (!(await insert(id, { kind, scope: '', value }))) {
			await update()
		}
	}

	const valueAt = async (id: string): Promise<unknown> => (await rowOf(id))?.value

	const leaseRows = (key: string): Where[] => [
		{ kind: { equals: 'lease' } },
		{ scope: { equals: key } },
	]

	const leaseKeyOf = (key: string): string => {
		if (stateKindOf(key) !== 'lease') {
			throw new Error(`analytics: "${key}" is not a lease`)
		}
		return key
	}

	/** Gives back the slot rows a claim took before it lost, so they keep no one else out. */
	const drop = async (ids: readonly string[]): Promise<void> => {
		if (ids.length > 0) {
			await payload.db.deleteMany({
				collection: collection(),
				where: { id: { in: [...ids] } },
				req: DETACHED,
			})
		}
	}

	return {
		async claim(key, owner, ttlMs) {
			const lease = leaseKeyOf(key)
			const period = leaseTtl(ttlMs)
			const at = now()
			const current = Math.floor(at.getTime() / period)
			const taken: string[] = []
			for (const slot of [current, current + 1]) {
				const id = slotId(lease, slot)
				const held = await rowOf(id)
				if (held?.leaseOwner === owner) {
					continue
				}
				const won =
					held === undefined &&
					(await insert(id, {
						kind: 'lease',
						scope: lease,
						leaseOwner: owner,
						leaseUntil: new Date((slot + 1) * period).toISOString(),
					}))
				if (!won && (await rowOf(id))?.leaseOwner !== owner) {
					await drop(taken)
					return false
				}
				taken.push(id)
			}
			// Slots a whole period past keep no one out; clearing them keeps a lease at a few rows.
			await payload.db.deleteMany({
				collection: collection(),
				where: {
					and: [
						...leaseRows(lease),
						{ leaseUntil: { less_than: new Date(at.getTime() - period).toISOString() } },
					],
				},
				req: DETACHED,
			})
			return true
		},

		async held(key) {
			const lease = leaseKeyOf(key)
			const live = await rows(
				{ and: [...leaseRows(lease), { leaseUntil: { greater_than: now().toISOString() } }] },
				1
			)
			return live.length > 0
		},

		async release(key, owner) {
			const lease = leaseKeyOf(key)
			const mine: Where = { and: [...leaseRows(lease), { leaseOwner: { equals: owner } }] }
			const at = now().getTime()
			const held = (await rows(mine)).some((row) => (dateOf(row.leaseUntil)?.getTime() ?? 0) > at)
			await payload.db.deleteMany({ collection: collection(), where: mine, req: DETACHED })
			return held
		},

		async beat(task) {
			await put(heartbeatKey(task), 'heartbeat', { at: now().toISOString() })
		},

		async lastBeat(task) {
			return atOf(await valueAt(heartbeatKey(task)))
		},

		async cursor(task) {
			return cursorOf(await valueAt(cursorKey(task)))
		},

		async setCursor(task, cursor) {
			await put(cursorKey(task), 'cursor', { cursor })
		},
	}
}
