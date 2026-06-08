import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { Config } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { analytics } from '../../src/index'
import { ROLLUPS_SLUG, rollupsCollection } from '../../src/native/collections/rollups'
import { applyRollupDeltas } from '../../src/native/rollups/applyRollupDeltas'
import { memoryAdapter } from '../../src/testing/memoryAdapter'

describeForDb('analytics cross-db', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ plugin: analytics({ adapters: [memoryAdapter()] }), db })
	})

	afterAll(async () => {
		await booted.stop()
	})

	it(`boots against ${db}`, () => {
		expect(booted.payload).toBeDefined()
		expect(booted.db).toBe(db)
	})
})

const rollupsOnly = (config: Config): Config => {
	config.collections = [...(config.collections ?? []), rollupsCollection()]
	return config
}

describeForDb('native rollup atomic apply', {}, (db) => {
	let booted: BootedPayload
	beforeAll(async () => {
		booted = await bootPayload({ plugin: rollupsOnly, db })
	})
	afterAll(async () => {
		await booted.stop()
	})

	it(`upserts then atomically increments the same bucket on ${db}`, async () => {
		const key = {
			granularity: 'day' as const,
			period: new Date('2026-01-10T00:00:00Z'),
			path: '/p',
			dimension: '',
			dimvalue: '',
		}
		const delta = { key, inc: { pageviews: 1, events: 0, durationMs: 100, samples: 1 } }
		await applyRollupDeltas(booted.payload, [delta])
		await applyRollupDeltas(booted.payload, [delta])
		const { docs } = await booted.payload.find({
			collection: ROLLUPS_SLUG,
			where: { path: { equals: '/p' } },
			pagination: false,
		})
		expect(docs).toHaveLength(1)
		expect(docs[0]?.pageviews).toBe(2)
		expect(docs[0]?.durationMs).toBe(200)
		expect(docs[0]?.samples).toBe(2)
	})
})
