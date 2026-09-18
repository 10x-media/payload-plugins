import { describe, expect, it } from 'vitest'
import { EVENTS_SLUG } from '../collections/events'
import { ROLLUPS_SLUG } from '../collections/rollups'
import { SEEN_SLUG } from '../collections/seen'
import { saltKey } from '../ingest/salt'
import { type PruneOptions, pruneEventsTask } from './pruneTask'

interface DeleteCall {
	collection: string
	where: Record<string, unknown>
}

type Handler = (args: { req: unknown }) => Promise<{ output: Record<string, never> }>

const run = async (
	options: PruneOptions
): Promise<{ deletes: DeleteCall[]; deletedKeys: string[] }> => {
	const deletes: DeleteCall[] = []
	const deletedKeys: string[] = []
	const req = {
		payload: {
			db: {
				deleteMany: (args: DeleteCall) => {
					deletes.push(args)
					return Promise.resolve()
				},
			},
			kv: {
				delete: (key: string) => {
					deletedKeys.push(key)
					return Promise.resolve()
				},
			},
		},
	}
	await (pruneEventsTask(options).handler as unknown as Handler)({ req })
	return { deletes, deletedKeys }
}

const dayKey = (daysAgo: number): string => saltKey(new Date(Date.now() - daysAgo * 86_400_000))

describe('prune task', () => {
	it('sweeps the salts and deletes nothing when no retention is configured', async () => {
		const { deletes, deletedKeys } = await run({})
		expect(deletes).toEqual([])
		expect(deletedKeys.length).toBeGreaterThan(0)
	})

	it('keeps today and yesterday and sweeps the two-to-62-day window', async () => {
		const { deletedKeys } = await run({})
		expect(deletedKeys).not.toContain(dayKey(0))
		expect(deletedKeys).not.toContain(dayKey(1))
		expect(deletedKeys).toContain(dayKey(2))
		expect(deletedKeys).toContain(dayKey(62))
		expect(deletedKeys).not.toContain(dayKey(63))
		expect(deletedKeys).toHaveLength(61)
	})

	it('deletes events and the seen ledger older than retentionDays', async () => {
		const { deletes } = await run({ retentionDays: 30 })
		expect(deletes.map((call) => call.collection)).toEqual([EVENTS_SLUG, SEEN_SLUG])
		const cutoff = new Date(Date.now() - 30 * 86_400_000)
		for (const call of deletes) {
			const field = call.collection === EVENTS_SLUG ? 'timestamp' : 'period'
			const bound = (call.where[field] as { less_than: string }).less_than
			expect(Math.abs(new Date(bound).getTime() - cutoff.getTime())).toBeLessThan(10_000)
		}
	})

	it('leaves rollups alone until rollupRetentionDays is set', async () => {
		const only = await run({ retentionDays: 30 })
		expect(only.deletes.map((call) => call.collection)).not.toContain(ROLLUPS_SLUG)
		const both = await run({ retentionDays: 30, rollupRetentionDays: 90 })
		expect(both.deletes.map((call) => call.collection)).toEqual([
			EVENTS_SLUG,
			SEEN_SLUG,
			ROLLUPS_SLUG,
		])
	})

	it('reports no count it would have to load the deleted rows to know', async () => {
		const deletes: DeleteCall[] = []
		const req = {
			payload: {
				db: { deleteMany: () => Promise.resolve(deletes.length) },
				kv: { delete: () => Promise.resolve() },
			},
		}
		const result = await (pruneEventsTask({ retentionDays: 1 }).handler as unknown as Handler)({
			req,
		})
		expect(result.output).toEqual({})
	})
})
