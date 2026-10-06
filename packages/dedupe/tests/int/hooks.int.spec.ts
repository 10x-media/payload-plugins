import { describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionSlug } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { repointCustomers } from '../../dev/helpers/repointCustomers'
import { MERGES_SLUG } from '../../src/collections/slugs'
import { applyMerge } from '../../src/merge/apply'
import { getCollectionContext, getContext } from '../../src/plugin/context'
import { bootDedupe, CUSTOMERS, type Doc } from './fixtures'

const ORDERS = 'orders' as CollectionSlug
const TRIPS = 'trips' as CollectionSlug

type Call = {
	collection: string
	survivorId: number | string
	absorbedIds: (number | string)[]
	/** Every merged-in document still there when the hook runs. */
	absorbedThere: boolean
	transactional: boolean
}

/** `hooks.beforeRemove`, and the dev app's reference move built on it. */
describeForDb('dedupe beforeRemove hook', {}, (db) => {
	let fixture: Awaited<ReturnType<typeof bootDedupe>>
	const calls: Call[] = []
	let refuse = false
	let n = 0

	beforeAll(async () => {
		fixture = await bootDedupe(db, {
			hooks: {
				beforeRemove: async (args) => {
					const { req, collection, survivorId, absorbedIds } = args
					const there = await req.payload.find({
						collection: collection as CollectionSlug,
						where: { id: { in: absorbedIds } },
						depth: 0,
						overrideAccess: true,
						req,
					})
					calls.push({
						collection,
						survivorId,
						absorbedIds,
						absorbedThere: there.totalDocs === absorbedIds.length,
						transactional: Boolean(req.transactionID),
					})
					if (refuse) throw new Error('hook refused')
					if (collection === CUSTOMERS) await repointCustomers(args)
				},
			},
		})
	})

	afterAll(async () => {
		await fixture.booted.stop()
	})

	const twins = async () => {
		n++
		const data = { name: `Hook Twin${n}`, phone: `04488${n}1122` }
		return [
			await fixture.customer({ ...data, email: `hook.a${n}@hooks.test` }),
			await fixture.customer({ ...data, email: `hook.b${n}@hooks.test` }),
		] as [Doc, Doc]
	}
	const merge = (survivor: Doc, absorbed: Doc[]) =>
		applyMerge({
			req: fixture.req,
			ctx: getContext(fixture.booted.payload),
			col: getCollectionContext(fixture.booted.payload, CUSTOMERS),
			survivorId: survivor.id,
			absorbedIds: absorbed.map((doc) => doc.id),
			choices: {},
		})

	it('runs once per merge, before the merged-in documents leave, inside its transaction', async () => {
		const [keep, gone] = await twins()
		calls.length = 0
		await merge(keep, [gone])
		expect(calls).toEqual([
			{
				collection: CUSTOMERS,
				survivorId: keep.id,
				absorbedIds: [gone.id],
				absorbedThere: true,
				transactional: true,
			},
		])
	})

	it('rolls the merge back when it throws', async () => {
		const [keep, gone] = await twins()
		refuse = true
		try {
			await expect(merge(keep, [gone])).rejects.toThrow('hook refused')
		} finally {
			refuse = false
		}
		const still = (await fixture.booted.payload.findByID({
			collection: CUSTOMERS,
			id: gone.id,
			depth: 0,
		})) as Doc
		expect(still.deletedAt ?? null).toBeNull()
		const records = await fixture.booted.payload.db.count({
			collection: MERGES_SLUG,
			where: { survivor: { equals: String(keep.id) } },
		})
		expect(records.totalDocs).toBe(0)
	})

	it("moves the dev app's references to the survivor, a list without repeating it", async () => {
		const [keep, gone] = await twins()
		const { payload } = fixture.booted
		const order = (await payload.create({
			collection: ORDERS,
			data: { number: `O-${n}`, customer: gone.id } as never,
		})) as Doc
		const both = (await payload.create({
			collection: TRIPS,
			data: { title: `Both ${n}`, participants: [keep.id, gone.id] } as never,
		})) as Doc
		const one = (await payload.create({
			collection: TRIPS,
			data: { title: `One ${n}`, participants: [gone.id] } as never,
		})) as Doc
		await merge(keep, [gone])
		const read = async (collection: CollectionSlug, id: number | string) =>
			(await payload.findByID({ collection, id, depth: 0 })) as Doc
		expect((await read(ORDERS, order.id)).customer).toEqual(keep.id)
		expect((await read(TRIPS, both.id)).participants).toEqual([keep.id])
		expect((await read(TRIPS, one.id)).participants).toEqual([keep.id])
	})
})
