import { setTimeout as sleep } from 'node:timers/promises'
import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import type { AnalyticsAdapter, AnalyticsQuery } from '../../src/core/contract'
import { GOALS_SLUG } from '../../src/goals/collection'
import { analytics } from '../../src/index'
import { STATE_SLUG } from '../../src/native/collections/slugs'
import { native } from '../../src/native/nativeAdapter'
import { type AnalyticsRuntime, getRuntime } from '../../src/plugin/runtime'
import { memoryAdapter } from '../../src/testing/memoryAdapter'
import { aroundNow, postBeacon, storedHits } from './nativeHelpers'

/**
 * Bursts on every database via `Promise.all`. Racing `purchase` retries and cross-instance salt
 * creation are covered in revenueIdempotency.int.spec.ts and nativeState.int.spec.ts.
 */

/** A source outside every registry that counts reads and answers after a beat, so they overlap. */
const recordingAdapter = () => {
	let calls = 0
	const adapter: AnalyticsAdapter = {
		id: 'recording',
		label: 'Recording',
		capabilities: memoryAdapter().capabilities,
		isConfigured: () => true,
		query: async (q) => {
			calls += 1
			await sleep(50)
			return {
				rows: [],
				totals: { pageviews: 7 },
				meta: { provider: 'recording', fetchedAt: q.dateRange.end.toISOString() },
			}
		},
	}
	return { adapter, calls: () => calls }
}

const runtimeOf = (booted: BootedPayload): AnalyticsRuntime => {
	const runtime = getRuntime(booted.payload)
	if (!runtime) {
		throw new Error('the plugin builds a runtime at boot')
	}
	return runtime
}

const configEpochOf = (booted: BootedPayload): ((scope?: string | null) => Promise<string>) => {
	const epoch = runtimeOf(booted).configEpoch
	if (!epoch) {
		throw new Error('an install with the goals collection keys reads on a config epoch')
	}
	return epoch
}

const recipe = (month: number): AnalyticsQuery => ({
	metrics: ['pageviews'],
	dateRange: {
		start: new Date(Date.UTC(2026, month, 1)),
		end: new Date(Date.UTC(2026, month, 28)),
	},
})

const BURST_HOST = 'burst.test'

describeForDb('analytics under concurrent requests', {}, (db) => {
	const adapter = native()
	const recording = recordingAdapter()
	const plugin = () =>
		analytics({
			adapters: [adapter],
			capture: { gate: 'off' },
			goals: { collection: true },
			jobs: false,
		})
	let booted: BootedPayload
	let second: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ db, plugin: plugin() })
		second = await bootPayload({ db, plugin: plugin(), attachTo: booted })
	}, 240_000)

	afterAll(async () => {
		await runtimeOf(booted).engine.idle?.()
		await second?.stop()
		await booted?.stop()
	})

	it(`counts 50 beacons one visitor sends at once as 50 pageviews in 1 visit under 1 salt on ${db}`, async () => {
		const answers = await Promise.all(
			Array.from({ length: 50 }, (_, i) =>
				postBeacon(booted.payload, { type: 'pageview', path: `/burst/${i}` }, { host: BURST_HOST })
			)
		)
		expect(answers.map((answer) => answer.status)).toEqual(Array(50).fill(202))

		const read = await adapter.query(
			{
				hostname: BURST_HOST,
				metrics: ['pageviews', 'visitors', 'sessions'],
				dateRange: aroundNow(),
			},
			{ payload: booted.payload }
		)
		expect(read.totals).toEqual({ pageviews: 50, visitors: 1, sessions: 1 })

		// These are the install's first hits, so the burst also raced to create the day's salt.
		const hits = await storedHits(booted.payload, { hostname: { equals: BURST_HOST } })
		expect(hits).toHaveLength(50)
		expect(new Set(hits.map((hit) => hit.v)).size).toBe(1)
		const day = new Date(String(hits[0]?.ts)).toISOString().slice(0, 10)
		const salts = await booted.payload.db.count({
			collection: STATE_SLUG,
			where: { id: { equals: `salt:${day}` } },
			req: {},
		})
		expect(salts.totalDocs).toBe(1)
	})

	it(`asks the source once for 10 cold reads of one recipe sent at once on ${db}`, async () => {
		const engine = runtimeOf(booted).engine
		const before = recording.calls()
		const answers = await Promise.all(
			Array.from({ length: 10 }, () => engine.read(recording.adapter, recipe(0)))
		)
		expect(recording.calls() - before).toBe(1)
		expect(answers.map((answer) => answer.totals?.pageviews)).toEqual(Array(10).fill(7))
	})

	it(`moves the config epoch on each of 8 goal saves made at once, and retires the cached read, on ${db}`, async () => {
		const epoch = configEpochOf(booted)
		const engine = runtimeOf(booted).engine
		await engine.read(recording.adapter, recipe(1))
		const cachedCalls = recording.calls()
		await engine.read(recording.adapter, recipe(1))
		expect(recording.calls()).toBe(cachedCalls)

		const before = await epoch()
		const created = await Promise.all(
			Array.from({ length: 8 }, async (_, i) => {
				const goal = await booted.payload.create({
					collection: GOALS_SLUG,
					data: { name: `Race ${i}`, slug: `race-${i}`, enabled: true, match: { kind: 'goal' } },
					overrideAccess: true,
				})
				return { id: goal.id, seen: await epoch() }
			})
		)
		for (const { seen } of created) {
			expect(seen).not.toBe(before)
		}
		const afterCreates = await epoch()
		// The instance that saved holds no stale memo: an instance reading the committed rows agrees.
		expect(await configEpochOf(second)()).toBe(afterCreates)
		await engine.read(recording.adapter, recipe(1))
		expect(recording.calls()).toBe(cachedCalls + 1)

		const updated = await Promise.all(
			created.map(async ({ id }, i) => {
				await booted.payload.update({
					collection: GOALS_SLUG,
					id,
					data: { name: `Race ${i} renamed` },
					overrideAccess: true,
				})
				return epoch()
			})
		)
		for (const seen of updated) {
			expect(seen).not.toBe(afterCreates)
		}
		await engine.read(recording.adapter, recipe(1))
		expect(recording.calls()).toBe(cachedCalls + 2)
	})
})
