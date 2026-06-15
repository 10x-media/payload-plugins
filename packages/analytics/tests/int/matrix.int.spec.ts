import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { Config } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { analytics } from '../../src/index'
import { ROLLUPS_SLUG, rollupsCollection } from '../../src/native/collections/rollups'
import { SEEN_SLUG, seenCollection } from '../../src/native/collections/seen'
import { applyRollupDeltas } from '../../src/native/rollups/applyRollupDeltas'
import { bumpRollup } from '../../src/native/rollups/bumpRollup'
import { insertIfNew } from '../../src/native/rollups/insertIfNew'
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

const seenOnly = (config: Config): Config => {
	config.collections = [...(config.collections ?? []), seenCollection()]
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

describeForDb('native bumpRollup baseline', {}, (db) => {
	let booted: BootedPayload
	beforeAll(async () => {
		booted = await bootPayload({ plugin: rollupsOnly, db })
	})
	afterAll(async () => {
		await booted.stop()
	})

	it(`initializes the full metric baseline when a partial bump creates the row on ${db}`, async () => {
		const key = {
			granularity: 'day' as const,
			period: new Date('2026-03-01T00:00:00Z'),
			path: '/baseline',
			dimension: '',
			dimvalue: '',
		}
		await bumpRollup(booted.payload, key, { visitors: 1 })
		const { docs } = await booted.payload.find({
			collection: ROLLUPS_SLUG,
			where: { path: { equals: '/baseline' } },
			pagination: false,
		})
		const row = docs[0] as { visitors: number; sessions: number; pageviews: number } | undefined
		expect(row?.visitors).toBe(1)
		expect(row?.sessions).toBe(0)
		expect(row?.pageviews).toBe(0)
	})
})

describeForDb('native insertIfNew dedup', {}, (db) => {
	let booted: BootedPayload
	beforeAll(async () => {
		booted = await bootPayload({ plugin: seenOnly, db })
	})
	afterAll(async () => {
		await booted.stop()
	})

	it(`returns true once then false for the same key on ${db}`, async () => {
		const key = {
			bucket: 'b1',
			kind: 'visitor',
			value: 'v1',
			period: new Date('2026-01-10T00:00:00Z'),
		}
		expect(await insertIfNew(booted.payload, SEEN_SLUG, key)).toBe(true)
		expect(await insertIfNew(booted.payload, SEEN_SLUG, key)).toBe(false)
	})

	it(`treats distinct values as new and a repeat as seen on ${db}`, async () => {
		const period = new Date('2026-01-10T00:00:00Z')
		expect(
			await insertIfNew(booted.payload, SEEN_SLUG, {
				bucket: 'b2',
				kind: 'visitor',
				value: 'vA',
				period,
			})
		).toBe(true)
		expect(
			await insertIfNew(booted.payload, SEEN_SLUG, {
				bucket: 'b2',
				kind: 'visitor',
				value: 'vB',
				period,
			})
		).toBe(true)
		expect(
			await insertIfNew(booted.payload, SEEN_SLUG, {
				bucket: 'b2',
				kind: 'visitor',
				value: 'vA',
				period,
			})
		).toBe(false)
	})
})
