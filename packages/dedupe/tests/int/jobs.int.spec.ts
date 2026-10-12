import { describeForDb } from '@10x-media/payload-test-harness'
import { createLocalReq, initTransaction, killTransaction } from 'payload'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'

import { PAIRS_SLUG } from '../../src/collections/slugs'
import { pairKeyFor } from '../../src/match/keys'
import { getCollectionContext, getContext } from '../../src/plugin/context'
import { findPairByKey, upsertPair } from '../../src/queue/pairs'
import { bootDedupe, CUSTOMERS, type Doc, emitted } from './fixtures'

/** The check on save as a job: it runs after the save commits, apart from the save. */
describeForDb('dedupe check on the jobs queue', {}, (db) => {
	let fixture: Awaited<ReturnType<typeof bootDedupe>>
	let n = 0

	const runJobs = () => fixture.booted.payload.jobs.run({ queue: 'dedupe' })
	const found = (id: number | string) =>
		emitted.filter(
			(event) =>
				event.type === 'pair.found' && (event.docA === String(id) || event.docB === String(id))
		)
	const twin = (tag: string) => ({
		email: `${tag}.${n}@jobs.test`,
		name: `Jobs Twin${n}`,
		phone: `04433${n}1122`,
	})

	beforeAll(async () => {
		fixture = await bootDedupe(db, { disableJobsQueue: false })
	})

	afterAll(async () => {
		await fixture.booted.stop()
	})

	it('finds the pair once the job runs, not during the save', async () => {
		n++
		const first = await fixture.customer(twin('a'))
		await runJobs()
		const second = await fixture.customer(twin('b'))
		expect(await fixture.pairsFor(second.id)).toEqual([])
		await runJobs()
		expect((await fixture.pairsFor(second.id)).map((pair) => pair.status)).toEqual(['open'])
		expect(found(first.id)).toHaveLength(1)
	})

	it('reports no pair for a save that rolled back', async () => {
		n++
		await fixture.customer(twin('a'))
		await runJobs()
		const req = await createLocalReq({}, fixture.booted.payload)
		await initTransaction(req)
		const lost = (await fixture.booted.payload.create({
			collection: CUSTOMERS,
			data: twin('b') as never,
			depth: 0,
			req,
		})) as Doc
		await killTransaction(req)
		await runJobs()
		expect(found(lost.id)).toEqual([])
		expect(await fixture.pairsFor(lost.id)).toEqual([])
	})

	it('saves the document even when writing its pair fails', async () => {
		n++
		const first = await fixture.customer(twin('a'))
		await runJobs()
		const create = fixture.booted.payload.db.create.bind(fixture.booted.payload.db)
		const spy = vi.spyOn(fixture.booted.payload.db, 'create').mockImplementation((args) => {
			if (args.collection === PAIRS_SLUG) throw new Error('pair write failed')
			return create(args)
		})
		let second: Doc
		try {
			second = await fixture.customer(twin('b'))
		} finally {
			spy.mockRestore()
		}
		await runJobs()
		expect(
			(await fixture.pairsFor(second.id)).map((pair) => [pair.docA, pair.docB].sort())
		).toEqual([[String(first.id), String(second.id)].sort()])
	})

	it('updates a pair another worker created in the meantime instead of failing on it', async () => {
		n++
		const first = await fixture.customer(twin('a'))
		const second = await fixture.customer(twin('b'))
		await runJobs()
		const ctx = getContext(fixture.booted.payload)
		const col = getCollectionContext(fixture.booted.payload, CUSTOMERS)
		const req = await createLocalReq({}, fixture.booted.payload)
		const row = await upsertPair({
			req,
			ctx,
			col,
			a: first.id,
			b: second.id,
			result: { score: 0.99, signals: [] },
			seenAt: new Date().toISOString(),
			tenant: null,
			known: null,
		})
		expect(row?.score).toBe(0.99)
		const stored = await findPairByKey(req, pairKeyFor(CUSTOMERS, first.id, second.id))
		expect(stored?.id).toBe(row?.id)
	})
})
