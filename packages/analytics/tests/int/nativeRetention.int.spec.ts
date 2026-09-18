import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { analytics } from '../../src/index'
import { EVENTS_SLUG } from '../../src/native/collections/events'
import { ROLLUPS_SLUG } from '../../src/native/collections/rollups'
import { SEEN_SLUG } from '../../src/native/collections/seen'
import { platformHeaderResolver } from '../../src/native/geo/geoResolver'
import { makeIngestHandler } from '../../src/native/ingest/endpoint'
import { saltKey } from '../../src/native/ingest/salt'
import { native } from '../../src/native/nativeAdapter'
import { type PruneOptions, pruneEventsTask } from '../../src/native/retention/pruneTask'
import { ingestRequest } from './ingestRequest'

const DAY_MS = 86_400_000

const ingest = (booted: BootedPayload, path: string) =>
	makeIngestHandler({ geoResolver: platformHeaderResolver })(
		ingestRequest(booted.payload, { type: 'pageview', path, hostname: 'h', durationMs: 500 })
	)

const prune = async (booted: BootedPayload, options: PruneOptions): Promise<void> => {
	const handler = pruneEventsTask(options).handler as (args: {
		req: { payload: BootedPayload['payload'] }
	}) => Promise<unknown>
	await handler({ req: { payload: booted.payload } })
}

const counts = async (booted: BootedPayload): Promise<Record<string, number>> => {
	const entries = await Promise.all(
		[EVENTS_SLUG, SEEN_SLUG, ROLLUPS_SLUG].map(async (slug) => {
			const { totalDocs } = await booted.payload.count({ collection: slug as never })
			return [slug, totalDocs] as const
		})
	)
	return Object.fromEntries(entries)
}

describeForDb('native retention', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: analytics({ adapters: [native({ retentionDays: 30, rollupRetentionDays: 365 })] }),
			db,
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('registers the nightly task', () => {
		const slugs = (booted.payload.config.jobs?.tasks ?? []).map((task) => task.slug)
		expect(slugs).toContain('analytics-prune-events')
	})

	it('keeps everything still inside its window', async () => {
		await ingest(booted, '/fresh')
		await prune(booted, { retentionDays: 30, rollupRetentionDays: 365 })
		const after = await counts(booted)
		expect(after[EVENTS_SLUG]).toBeGreaterThan(0)
		expect(after[SEEN_SLUG]).toBeGreaterThan(0)
		expect(after[ROLLUPS_SLUG]).toBeGreaterThan(0)
	})

	it('prunes events and the seen ledger while rollups keep their own window', async () => {
		await ingest(booted, '/old')
		const before = await counts(booted)
		expect(before[EVENTS_SLUG]).toBeGreaterThan(0)
		await prune(booted, { retentionDays: 0 })
		const after = await counts(booted)
		expect(after[EVENTS_SLUG]).toBe(0)
		expect(after[SEEN_SLUG]).toBe(0)
		expect(after[ROLLUPS_SLUG]).toBe(before[ROLLUPS_SLUG])
	})

	it('prunes rollups once a rollup window is set', async () => {
		await ingest(booted, '/rolled')
		expect((await counts(booted))[ROLLUPS_SLUG]).toBeGreaterThan(0)
		await prune(booted, { retentionDays: 0, rollupRetentionDays: 0 })
		expect((await counts(booted))[ROLLUPS_SLUG]).toBe(0)
	})

	it('sweeps the daily salts from two days back, keeping today and yesterday', async () => {
		const days = [0, 1, 2, 3, 70]
		const keys = days.map((day) => saltKey(new Date(Date.now() - day * DAY_MS)))
		await Promise.all(keys.map((key) => booted.payload.kv.set(key, { salt: 'test' })))
		await prune(booted, {})
		const present = await Promise.all(keys.map((key) => booted.payload.kv.has(key)))
		expect(present).toEqual([true, true, false, false, true])
	})
})
