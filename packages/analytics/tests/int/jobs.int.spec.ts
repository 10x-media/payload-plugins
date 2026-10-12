import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { Payload, PayloadRequest, Plugin } from 'payload'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { ProviderHttpError } from '../../src/adapters/http/fetchJson'
import type { AnalyticsQuery, AnalyticsResult } from '../../src/core/contract'
import { DEFAULT_JOBS, TASK_SLUGS } from '../../src/core/jobs'
import { analytics } from '../../src/index'
import { stateStoreOf } from '../../src/maintenance/lease'
import { STATE_SLUG } from '../../src/native/collections/slugs'
import { native } from '../../src/native/nativeAdapter'
import { getRuntime, settleRetiredRuntimes } from '../../src/plugin/runtime'
import { warmTask } from '../../src/plugin/warmTask'
import { REKEY_CURSOR } from '../../src/sync/rekeyDurations'
import { syncTask, upsertSyncRow } from '../../src/sync/syncTask'
import { memoryAdapter } from '../../src/testing/memoryAdapter'
import { readForWidget } from '../../src/widgets/readForWidget'
import { readForWidgetRealtime } from '../../src/widgets/readForWidgetRealtime'
import { readerRequest } from './readerRequest'

const DAY = 86_400_000

/** A vendor source whose live count the spec can make fail, as a revoked key would. */
const vendorSource = () => {
	const source = memoryAdapter()
	// Today and yesterday: inside the three days a sync reads back, today counted, even once
	// midnight passes before it runs.
	for (const daysAgo of [0, 1]) {
		source.record({ path: '/synced', timestamp: new Date(Date.now() - daysAgo * DAY) })
	}
	const live = vi.fn(
		async (_query: AnalyticsQuery): Promise<AnalyticsResult> => ({
			rows: [],
			totals: { visitors: 2 },
			meta: { provider: 'memory', fetchedAt: new Date().toISOString() },
		})
	)
	return Object.assign(source, { realtime: live })
}

type Handler = (args: { req: PayloadRequest }) => Promise<unknown>

const handlerOf = (task: { handler: unknown }): Handler => {
	const { handler } = task
	if (typeof handler !== 'function') {
		throw new Error('the task runs a function')
	}
	return (args) => handler(args)
}

const outputOf = (result: unknown): unknown =>
	typeof result === 'object' && result !== null && 'output' in result ? result.output : undefined

const jobReq = (payload: Payload): PayloadRequest => ({ payload }) as PayloadRequest

describeForDb('analytics sync and warm on job workers', {}, (db) => {
	const vendor = vendorSource()
	let first: BootedPayload
	let second: BootedPayload

	const plugin = (): Plugin =>
		analytics({
			adapters: [vendor],
			capture: { gate: 'off' },
			sync: true,
			cache: { warm: true },
			jobs: { queue: 'analytics' },
		})

	const sync = handlerOf(
		syncTask({ schedule: DEFAULT_JOBS.sync, lookbackDays: 3, collectionSlug: 'analytics-daily' })
	)
	const warm = handlerOf(warmTask({ schedule: DEFAULT_JOBS.warm, windowHours: 24, maxReads: 50 }))

	beforeAll(async () => {
		first = await bootPayload({ db, disableOnInit: true, plugin: plugin() })
		second = await bootPayload({ db, attachTo: first, disableOnInit: true, plugin: plugin() })
	}, 240_000)

	afterAll(async () => {
		await settleRetiredRuntimes(second.payload)
		await settleRetiredRuntimes(first.payload)
		await second.stop()
		await first.stop()
	})

	it(`keeps its leases and heartbeats in analytics-state without native() on ${db}`, () => {
		expect(Object.hasOwn(first.payload.collections, STATE_SLUG)).toBe(true)
		expect(stateStoreOf(first.payload)).toBeDefined()
	})

	it(`runs sync and warm to success through payload.jobs.run() on its queue on ${db}`, async () => {
		const { payload } = first
		// A reader's read the warm task can repeat.
		expect(
			(
				await readForWidget({
					req: readerRequest(payload),
					metrics: ['pageviews'],
					timeframe: 'last7days',
					now: new Date(),
				})
			).status
		).toBe('ok')
		const queued = []
		for (const task of [TASK_SLUGS.sync, TASK_SLUGS.warm]) {
			queued.push([task, (await payload.jobs.queue({ task, queue: 'analytics', input: {} })).id])
		}
		const run = await payload.jobs.run({ queue: 'analytics' })
		for (const [task, id] of queued) {
			expect(run.jobStatus?.[String(id)]?.status, String(task)).toBe('success')
		}
		const { totalDocs } = await payload.count({ collection: 'analytics-daily' as never })
		expect(totalDocs).toBe(2)
		const state = stateStoreOf(payload)
		expect(await state?.lastBeat(TASK_SLUGS.sync)).toBeInstanceOf(Date)
		expect(await state?.lastBeat(TASK_SLUGS.warm)).toBeInstanceOf(Date)
	})

	it(`does a sync once when two workers start it at the same moment on ${db}`, async () => {
		const outputs = await Promise.all([
			sync({ req: jobReq(first.payload) }),
			sync({ req: jobReq(second.payload) }),
		])
		const ran = outputs.map((result) => (outputOf(result) as { ran?: boolean } | undefined)?.ran)
		expect(ran.sort()).toEqual([false, true])
	})

	it(`does a warm run once when two workers start it at the same moment on ${db}`, async () => {
		const outputs = await Promise.all([
			warm({ req: jobReq(first.payload) }),
			warm({ req: jobReq(second.payload) }),
		])
		const ran = outputs.map((result) => (outputOf(result) as { ran?: boolean } | undefined)?.ran)
		expect(ran.sort()).toEqual([false, true])
	})

	it(`writes a day once however many runs upsert it at the same moment on ${db}`, async () => {
		const row = (pageviews: number) => ({
			source: 'race',
			date: new Date(Date.UTC(2026, 9, 1)),
			syncedAt: new Date(),
			scope: '',
			pageviews,
		})
		await Promise.all(
			[1, 2, 3, 4, 5, 6].map((pageviews) =>
				upsertSyncRow(
					pageviews % 2 === 0 ? first.payload : second.payload,
					'analytics-daily',
					row(pageviews)
				)
			)
		)
		const { docs } = await first.payload.find({
			collection: 'analytics-daily' as never,
			where: { source: { equals: 'race' } },
		})
		expect(docs).toHaveLength(1)
		expect([1, 2, 3, 4, 5, 6]).toContain((docs[0] as { pageviews?: number }).pageviews)
		await upsertSyncRow(first.payload, 'analytics-daily', row(9))
		const again = await first.payload.find({
			collection: 'analytics-daily' as never,
			where: { source: { equals: 'race' } },
		})
		expect(again.docs.map((doc) => (doc as { pageviews?: number }).pageviews)).toEqual([9])
	})

	it(`records where a sync cut short by its budget stopped, and clears it once one finishes, on ${db}`, async () => {
		const state = stateStoreOf(first.payload)
		const cut = handlerOf(
			syncTask({
				schedule: DEFAULT_JOBS.sync,
				lookbackDays: 3,
				collectionSlug: 'analytics-daily',
				budgetMs: 0,
			})
		)
		expect(outputOf(await cut({ req: jobReq(first.payload) }))).toMatchObject({
			ran: true,
			finished: false,
			synced: 0,
		})
		expect(await stateStoreOf(second.payload)?.cursor(TASK_SLUGS.sync)).toBe('null')
		expect(outputOf(await sync({ req: jobReq(second.payload) }))).toMatchObject({
			ran: true,
			finished: true,
		})
		expect(await state?.cursor(TASK_SLUGS.sync)).toBeNull()
	})

	it(`syncs again without adding a row for a day it already wrote on ${db}`, async () => {
		const count = async () =>
			(await first.payload.count({ collection: 'analytics-daily' as never })).totalDocs
		const before = await count()
		expect(outputOf(await sync({ req: jobReq(first.payload) }))).toMatchObject({ ran: true })
		expect(await count()).toBe(before)
	})

	it(`moves the time per visit vendor rows held under avgDuration to visitDuration once, on ${db}`, async () => {
		const state = stateStoreOf(first.payload)
		await state?.setCursor(REKEY_CURSOR, null)
		const day = new Date(Date.UTC(2026, 0, 1))
		const syncedAt = new Date(Date.now() - 30 * DAY)
		const held: Array<[string, number]> = [
			['plausible', 42_000],
			['ga4:abc123', 9000],
			['custom', 5000],
		]
		for (const [source, avgDuration] of held) {
			await upsertSyncRow(first.payload, 'analytics-daily', {
				source,
				date: day,
				syncedAt,
				scope: '',
				avgDuration,
			})
		}
		const cut = handlerOf(
			syncTask({
				schedule: DEFAULT_JOBS.sync,
				lookbackDays: 3,
				collectionSlug: 'analytics-daily',
				budgetMs: 0,
			})
		)
		expect(outputOf(await cut({ req: jobReq(first.payload) }))).toMatchObject({
			ran: true,
			finished: false,
			synced: 0,
		})
		const cutoff = await state?.cursor(REKEY_CURSOR)
		expect(cutoff).not.toBe('done')
		expect(Number.isNaN(Date.parse(cutoff ?? ''))).toBe(false)

		expect(outputOf(await sync({ req: jobReq(second.payload) }))).toMatchObject({
			ran: true,
			finished: true,
		})
		expect(await state?.cursor(REKEY_CURSOR)).toBe('done')
		const { docs } = await first.payload.find({
			collection: 'analytics-daily' as never,
			where: { date: { equals: day.toISOString() } },
			sort: 'source',
		})
		const durations = docs.map((doc) => {
			const row = doc as {
				source?: string
				avgDuration?: number | null
				visitDuration?: number | null
			}
			return [row.source, row.avgDuration ?? null, row.visitDuration ?? null]
		})
		expect(durations).toEqual([
			['custom', 5000, null],
			['ga4:abc123', null, 9000],
			['plausible', null, 42_000],
		])

		// Done once: a row written later under the old name is a host's own, and stays.
		await upsertSyncRow(first.payload, 'analytics-daily', {
			source: 'umami',
			date: day,
			syncedAt,
			scope: '',
			avgDuration: 7000,
		})
		await sync({ req: jobReq(first.payload) })
		const umamiRow = await first.payload.find({
			collection: 'analytics-daily' as never,
			where: { and: [{ date: { equals: day.toISOString() } }, { source: { equals: 'umami' } }] },
		})
		expect((umamiRow.docs[0] as { avgDuration?: number } | undefined)?.avgDuration).toBe(7000)
	})

	it(`reads a vendor's live count through its lane, which a refused key closes on ${db}`, async () => {
		const read = () =>
			readForWidgetRealtime({
				req: readerRequest(second.payload),
				metric: 'visitors',
				windowMinutes: 15,
				adapterId: 'memory',
				now: new Date(),
			})
		const engine = getRuntime(second.payload)?.engine
		const realtime = engine?.realtime
		if (!engine || !realtime) {
			throw new Error('runtime engine missing')
		}
		let throughEngine = 0
		engine.realtime = (adapter, query) => {
			throughEngine++
			return realtime.call(engine, adapter, query)
		}
		try {
			vendor.realtime.mockRejectedValue(new ProviderHttpError(401, 'memory', 'key revoked'))
			await expect(read()).resolves.toMatchObject({ status: 'misconfigured', activeNow: 0 })
			const calls = vendor.realtime.mock.calls.length
			await expect(read()).resolves.toMatchObject({ status: 'misconfigured' })
			expect(vendor.realtime.mock.calls.length).toBe(calls)
			expect(throughEngine).toBe(2)
		} finally {
			engine.realtime = realtime
		}
	})
})

describeForDb('analytics with jobs: false', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			disableOnInit: true,
			plugin: analytics({
				adapters: [native(), memoryAdapter()],
				capture: { gate: 'off' },
				jobs: false,
			}),
		})
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	it(`registers none of its tasks, so Payload's jobs stay off on ${db}`, () => {
		const slugs = (booted.payload.config.jobs?.tasks ?? []).map((task) => task.slug)
		for (const slug of Object.values(TASK_SLUGS)) {
			expect(slugs).not.toContain(slug)
		}
		expect(Object.hasOwn(booted.payload.collections, 'payload-jobs')).toBe(false)
	})
})
