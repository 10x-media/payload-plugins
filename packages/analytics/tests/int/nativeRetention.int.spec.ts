import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { analytics } from '../../src/index'
import { EVENTS_SLUG } from '../../src/native/collections/events'
import { ROLLUPS_SLUG } from '../../src/native/collections/rollups'
import { SEEN_SLUG } from '../../src/native/collections/seen'
import { platformHeaderResolver } from '../../src/native/geo/geoResolver'
import { makeIngestHandler } from '../../src/native/ingest/endpoint'
import { dailySalt, saltKey } from '../../src/native/ingest/salt'
import { native } from '../../src/native/nativeAdapter'
import {
	PRUNE_TASK_SLUG,
	type PruneOptions,
	pruneEventsTask,
} from '../../src/native/retention/pruneTask'
import { ingestRequest } from './ingestRequest'

const DAY_MS = 86_400_000
// Pinned, so a run and the assertions after it cannot straddle a UTC midnight. Offsetting the
// task's clock forward is what makes a fixture written now older than a real positive window.
const NOW = Date.now()
const at = (offsetDays: number) => (): number => NOW + offsetDays * DAY_MS

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
		expect(slugs).toContain(PRUNE_TASK_SLUG)
	})

	it('keeps everything still inside its window', async () => {
		await ingest(booted, '/fresh')
		await prune(booted, { retentionDays: 30, rollupRetentionDays: 365, now: at(0) })
		const after = await counts(booted)
		expect(after[EVENTS_SLUG]).toBeGreaterThan(0)
		expect(after[SEEN_SLUG]).toBeGreaterThan(0)
		expect(after[ROLLUPS_SLUG]).toBeGreaterThan(0)
	})

	// A window of zero means "keep everything" wherever it is configured, so the task must never
	// read it as a cutoff of now and wipe the store.
	it('deletes nothing for a window of zero, however far the clock has moved', async () => {
		const before = await counts(booted)
		await prune(booted, { retentionDays: 0, rollupRetentionDays: -1, now: at(400) })
		expect(await counts(booted)).toEqual(before)
	})

	it('prunes events and the seen ledger while rollups keep their own window', async () => {
		await ingest(booted, '/old')
		const before = await counts(booted)
		expect(before[EVENTS_SLUG]).toBeGreaterThan(0)
		await prune(booted, { retentionDays: 30, now: at(40) })
		const after = await counts(booted)
		expect(after[EVENTS_SLUG]).toBe(0)
		expect(after[SEEN_SLUG]).toBe(0)
		expect(after[ROLLUPS_SLUG]).toBe(before[ROLLUPS_SLUG])
	})

	it('prunes rollups once a rollup window is set', async () => {
		await ingest(booted, '/rolled')
		expect((await counts(booted))[ROLLUPS_SLUG]).toBeGreaterThan(0)
		await prune(booted, { retentionDays: 30, rollupRetentionDays: 90, now: at(400) })
		expect((await counts(booted))[ROLLUPS_SLUG]).toBe(0)
	})

	it('sweeps the daily salts from two days back, keeping today and yesterday', async () => {
		const days = [0, 1, 2, 3, 70]
		const keys = days.map((day) => saltKey(new Date(NOW - day * DAY_MS)))
		await Promise.all(keys.map((key) => booted.payload.kv.set(key, { salt: 'test' })))
		await prune(booted, { now: at(0) })
		const present = await Promise.all(keys.map((key) => booted.payload.kv.has(key)))
		expect(present).toEqual([true, true, false, false, true])
	})
})

describeForDb('native retention left unset', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ plugin: analytics({ adapters: [native()] }), db })
	})

	afterAll(async () => {
		await booted.stop()
	})

	// One task is what turns Payload's jobs on, the payload-jobs collection and the stats global
	// with it, so an install that configured no window must gain neither from this plugin.
	it('registers no prune task and brings no jobs collection with it', () => {
		const slugs = (booted.payload.config.jobs?.tasks ?? []).map((task) => task.slug)
		expect(slugs).not.toContain(PRUNE_TASK_SLUG)
		expect(booted.payload.config.jobs?.enabled).toBe(false)
		expect(booted.payload.config.collections.map((c) => c.slug)).not.toContain('payload-jobs')
	})

	it('still sweeps the salts a new day made stale, with no task to run', async () => {
		const now = new Date('2031-05-10T11:00:00.000Z')
		const key = (daysAgo: number): string => saltKey(new Date(now.getTime() - daysAgo * DAY_MS))
		await booted.payload.kv.set(key(1), { salt: 'yesterday' })
		await booted.payload.kv.set(key(2), { salt: 'stale' })
		await dailySalt(booted.payload, now)
		// The sweep is fire and forget, so the assertion waits for it rather than the caller.
		await vi.waitFor(async () => {
			expect(await booted.payload.kv.has(key(2))).toBe(false)
		})
		expect(await booted.payload.kv.has(key(1))).toBe(true)
		expect(await booted.payload.kv.has(key(0))).toBe(true)
	})
})
