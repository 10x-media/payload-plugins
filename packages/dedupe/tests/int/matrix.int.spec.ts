import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { type CollectionSlug, createLocalReq } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { PAIRS_SLUG } from '../../src/collections/slugs'
import { applyMerge } from '../../src/merge/apply'
import { getCollectionContext, getContext } from '../../src/plugin/context'
import { runScan } from '../../src/queue/scan'
import { collectionsFor, configOverrides, plugin } from './fixtures'

const CUSTOMERS = 'customers' as CollectionSlug

/** The cross-database run: the same index, scan and merge on Mongo and Postgres. */
describeForDb('dedupe cross-db', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin,
			db,
			collections: collectionsFor(db),
			configOverrides: configOverrides(),
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it(`indexes, scans and merges against ${db}`, async () => {
		const a = await booted.payload.create({
			collection: CUSTOMERS,
			data: { name: 'Ivan Petrenko', email: 'ivan@mail.com', phone: '0501234567' } as never,
			depth: 0,
		})
		const b = await booted.payload.create({
			collection: CUSTOMERS,
			data: { name: 'Petrenko Ivan', phone: '+380501234567', tags: ['t'] } as never,
			depth: 0,
		})

		const user = await booted.payload.create({
			collection: 'users' as CollectionSlug,
			data: { email: 'reviewer@example.com', password: 'password' } as never,
		})
		const req = await createLocalReq({ user: user as never }, booted.payload)
		const ctx = getContext(booted.payload)
		const col = getCollectionContext(booted.payload, 'customers')
		const summary = await runScan({ req, ctx, col })
		expect(summary.compared).toBeGreaterThanOrEqual(1)

		const pairs = await booted.payload.db.find({
			collection: PAIRS_SLUG,
			where: { status: { equals: 'open' } },
			pagination: false,
		})
		expect(pairs.docs).toHaveLength(1)

		await applyMerge({ req, ctx, col, survivorId: a.id, absorbedIds: [b.id], choices: {} })
		const merged = (await booted.payload.findByID({
			collection: CUSTOMERS,
			id: a.id,
			depth: 0,
		})) as Record<string, unknown>
		expect(merged.tags).toEqual(['t'])
		expect(merged.email).toBe('ivan@mail.com')
	})
})
