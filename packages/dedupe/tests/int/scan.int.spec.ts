import { describeForDb } from '@10x-media/payload-test-harness'
import type { PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'

import { KEYS_SLUG } from '../../src/collections/slugs'
import type { DedupePluginOptions } from '../../src/options'
import { getCollectionContext, getContext } from '../../src/plugin/context'
import { runScan } from '../../src/queue/scan'
import { bootDedupe, CUSTOMERS, pluginOptions } from './fixtures'

const customers = pluginOptions.collections?.customers as Exclude<
	NonNullable<DedupePluginOptions['collections']>[string],
	boolean | undefined
>

/**
 * A scan indexes documents side by side, and compares each pair once: in the first bucket its
 * documents share that is small enough to score.
 */
describeForDb('dedupe scan', {}, (db) => {
	let fixture: Awaited<ReturnType<typeof bootDedupe>>

	beforeAll(async () => {
		// A bucket of three documents is too large: the name below fills one for each of its keys.
		fixture = await bootDedupe(db, {
			collections: {
				...pluginOptions.collections,
				customers: { ...customers, match: { ...customers.match, maxBucket: 2 } as never },
			},
		})
	})

	afterAll(async () => {
		await fixture.booted.stop()
	})

	const scan = () =>
		runScan({
			req: fixture.req,
			ctx: getContext(fixture.booted.payload),
			col: getCollectionContext(fixture.booted.payload, CUSTOMERS),
		})

	/** The most key rows `run` has being written at the same moment. */
	const keyWritesAtOnce = async (run: () => Promise<unknown>): Promise<number> => {
		const { db: adapter } = fixture.booted.payload
		const create = adapter.create.bind(adapter)
		let writing = 0
		let most = 0
		const spy = vi.spyOn(adapter, 'create').mockImplementation(async (args) => {
			if (args.collection !== KEYS_SLUG) return create(args)
			most = Math.max(most, ++writing)
			try {
				return await create(args)
			} finally {
				writing--
			}
		})
		try {
			await run()
			return most
		} finally {
			spy.mockRestore()
		}
	}
	/** The most documents `run` has the adapter indexing at the same moment. */
	const indexesAtOnce = async (run: () => Promise<unknown>): Promise<number> => {
		const { adapter } = getCollectionContext(fixture.booted.payload, CUSTOMERS)
		const index = adapter.index?.bind(adapter)
		let indexing = 0
		let most = 0
		const spy = vi.spyOn(adapter, 'index').mockImplementation(async (args) => {
			most = Math.max(most, ++indexing)
			try {
				return await index?.(args)
			} finally {
				indexing--
			}
		})
		try {
			await run()
			return most
		} finally {
			spy.mockRestore()
		}
	}
	const unindexed = (data: Record<string, unknown>) =>
		fixture.booted.payload.db.create({ collection: CUSTOMERS, data, req: fixture.req })
	const index = async (doc: Record<string, unknown>, req: PayloadRequest) => {
		await getCollectionContext(fixture.booted.payload, CUSTOMERS).adapter.index?.({
			req,
			collection: CUSTOMERS,
			doc: doc as never,
		})
	}

	it("writes a document's keys together, and one at a time inside a transaction", async () => {
		const many = { name: { en: 'Many Keys Here' }, phone: '+49 151 4444444', tenant: 'writes' }
		const free = await unindexed(many)
		expect(await keyWritesAtOnce(() => index(free, fixture.req))).toBeGreaterThan(1)
		const held = await unindexed(many)
		const inTransaction = Object.assign(Object.create(fixture.req), { transactionID: 'held' })
		expect(await keyWritesAtOnce(() => index(held, inTransaction))).toBe(1)
	})

	it('indexes several documents of a scan at once', async () => {
		for (const phone of ['+49 151 5555551', '+49 151 5555552', '+49 151 5555553']) {
			await unindexed({ phone, tenant: 'single' })
		}
		expect(await indexesAtOnce(scan)).toBeGreaterThan(1)
	})

	it('compares a pair that shares several buckets once', async () => {
		const before = (await scan()).compared
		const twin = { name: 'Shared Buckets', phone: '+49 151 1111111', birthDate: '1980-03-20' }
		await fixture.customer({ ...twin, tenant: 'several' })
		await fixture.customer({ ...twin, tenant: 'several' })
		expect((await scan()).compared).toBe(before + 1)
	})

	it('compares a pair in the next bucket it shares when the first is too large to score', async () => {
		const before = (await scan()).compared
		const name = 'Crowded Name'
		await fixture.customer({
			name,
			phone: '+49 151 2222222',
			birthDate: '1970-01-20',
			tenant: 'crowded',
		})
		await fixture.customer({
			name,
			phone: '+49 151 2222222',
			birthDate: '1971-02-21',
			tenant: 'crowded',
		})
		await fixture.customer({
			name,
			phone: '+49 151 3333333',
			birthDate: '1972-03-22',
			tenant: 'crowded',
		})
		// The three share only name buckets, over the limit; the first two share a phone too.
		const summary = await scan()
		expect(summary.skippedBuckets).toBeGreaterThan(0)
		expect(summary.compared).toBe(before + 1)
	})
})
