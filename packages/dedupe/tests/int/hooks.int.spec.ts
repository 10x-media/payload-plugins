import { describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionSlug } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { repointCustomers } from '../../dev/helpers/repointCustomers'
import { applyMerge } from '../../src/merge/apply'
import type { BeforeRemoveArgs } from '../../src/options'
import { getCollectionContext, getContext } from '../../src/plugin/context'
import type { MergeChoice } from '../../src/schema/types'
import { bootDedupe, CUSTOMERS, type Doc, emitted, pluginOptions, TICKETS } from './fixtures'

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
	let handed: Pick<BeforeRemoveArgs, 'decisions' | 'snapshots'> | null = null
	let refuse = false
	let n = 0

	beforeAll(async () => {
		fixture = await bootDedupe(db, {
			collections: { ...pluginOptions.collections, users: { absorbed: 'delete' } },
			hooks: {
				beforeRemove: async (args) => {
					const { req, collection, survivorId, absorbedIds, snapshots, decisions } = args
					handed = { snapshots, decisions }
					// A paginated find first, as a host's hook may begin: on MongoDB it sends a count beside it.
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
	const merge = (survivor: Doc, absorbed: Doc[], choices: Record<string, MergeChoice> = {}) =>
		applyMerge({
			req: fixture.req,
			ctx: getContext(fixture.booted.payload),
			col: getCollectionContext(fixture.booted.payload, CUSTOMERS),
			survivorId: survivor.id,
			absorbedIds: absorbed.map((doc) => doc.id),
			choices,
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

	it('hands over the merged-in documents as they were, before their unique values are released', async () => {
		const [keep, gone] = await twins()
		// The primary takes the merged-in email, so the merged-in document gives it up for a placeholder.
		await merge(keep, [gone], { email: { doc: String(gone.id) } })
		expect(handed?.snapshots[String(gone.id)]?.email).toBe(gone.email)
		const email = handed?.decisions.find((decision) => decision.key === 'email')
		expect(email).toMatchObject({ source: String(gone.id), proposed: gone.email })
	})

	it('hands over the fields hidden from the API, and no credentials of a merged-in user', async () => {
		const { payload } = fixture.booted
		const merged = async (collection: CollectionSlug, keep: Doc, gone: Doc) => {
			await applyMerge({
				req: fixture.req,
				ctx: getContext(payload),
				col: getCollectionContext(payload, collection),
				survivorId: keep.id,
				absorbedIds: [gone.id],
				choices: {},
			})
			return handed?.snapshots[String(gone.id)] ?? {}
		}
		const ticket = (data: Record<string, unknown>) =>
			payload.create({ collection: TICKETS, data: data as never }) as Promise<Doc>
		const copy = await merged(
			TICKETS,
			await ticket({ title: `Hidden copy ${n}` }),
			await ticket({ title: `Hidden copy ${n}`, externalRef: 'crm-42' })
		)
		expect(copy.externalRef).toBe('crm-42')

		const USERS = 'users' as CollectionSlug
		const user = (email: string) =>
			payload.create({
				collection: USERS,
				data: { email, password: 'password' } as never,
			}) as Promise<Doc>
		const keep = await user(`keep-user${n}@hooks.test`)
		const gone = await user(`gone-user${n}@hooks.test`)
		await payload.login({
			collection: USERS,
			data: { email: `gone-user${n}@hooks.test`, password: 'password' },
		})
		const account = await merged(USERS, keep, gone)
		expect(account.email).toBe(`gone-user${n}@hooks.test`)
		expect(
			Object.keys(account).filter((key) => ['sessions', 'apiKey', 'hash', 'salt'].includes(key))
		).toEqual([])
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
		expect(emitted).toContainEqual(
			expect.objectContaining({ type: 'merge.failed', survivorId: String(keep.id) })
		)
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
