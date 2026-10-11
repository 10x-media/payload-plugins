import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionSlug, Payload } from 'payload'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { TASK_SLUGS } from '../../src/core/jobs'
import { analytics } from '../../src/index'
import { stateStoreOf } from '../../src/maintenance/lease'
import { trackServerEvent } from '../../src/native/ingest/serverTrack'
import { native } from '../../src/native/nativeAdapter'
import { heartbeatKey } from '../../src/native/store/state'
import {
	getRuntime,
	resolveRegistryFor,
	runtimeFactoryOf,
	settleRetiredRuntimes,
} from '../../src/plugin/runtime'
import { memoryAdapter } from '../../src/testing/memoryAdapter'
import { addCalendarDays, calendarDayOf, calendarDayStart } from '../../src/timeframe/calendar'
import { readForWidget } from '../../src/widgets/readForWidget'
import { INGEST_HOST } from './ingestRequest'
import { aroundNow, nativeOf, postBeacon } from './nativeHelpers'
import { readerRequest } from './readerRequest'

const DAY = 86_400_000

const SLUGS = {
	hits: 'site-hits',
	aggregates: 'site-totals',
	state: 'site-state',
	cache: 'site-cache',
	sync: 'site-daily',
	providers: 'site-providers',
	goals: 'site-goals',
} as const

const DEFAULT_SLUGS = [
	'analytics-hits',
	'analytics-aggregates',
	'analytics-state',
	'analytics-cache',
	'analytics-daily',
	'analytics-providers',
	'analytics-goals',
]

/**
 * A vendor source with two days the sync can copy: today and yesterday, which stay inside its
 * lookback even once midnight passes before it runs.
 */
const vendorSource = () => {
	const source = memoryAdapter()
	for (const daysAgo of [0, 1]) {
		source.record({ path: '/synced', timestamp: new Date(Date.now() - daysAgo * DAY) })
	}
	return source
}

const countIn = async (payload: Payload, slug: string): Promise<number> =>
	(await payload.db.count({ collection: slug as CollectionSlug, req: {}, where: {} })).totalDocs

type TaskSlug = (typeof TASK_SLUGS)[keyof typeof TASK_SLUGS]

const runTasks = async (payload: Payload, tasks: readonly TaskSlug[]): Promise<void> => {
	const queued: Array<[string, string]> = []
	for (const task of tasks) {
		const job = await payload.jobs.queue({ task, queue: 'analytics', input: {} })
		queued.push([task, String(job.id)])
	}
	const run = await payload.jobs.run({ queue: 'analytics' })
	for (const [task, id] of queued) {
		expect(run.jobStatus?.[id]?.status, task).toBe('success')
	}
}

describeForDb('analytics with every collection renamed', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			plugin: analytics({
				adapters: [
					native({
						collections: {
							hits: {
								slug: SLUGS.hits,
								overrides: (collection) => ({ ...collection, dbName: 'raw_hits' }),
							},
							aggregates: { slug: SLUGS.aggregates },
							state: { slug: SLUGS.state },
						},
					}),
					vendorSource(),
				],
				capture: { gate: 'off' },
				providers: { collection: { slug: SLUGS.providers } },
				goals: { collection: { slug: SLUGS.goals } },
				sync: { collection: { slug: SLUGS.sync } },
				cache: {
					collection: {
						slug: SLUGS.cache,
						overrides: (collection) => ({
							...collection,
							access: { ...collection.access, read: () => true },
						}),
					},
					warm: true,
				},
				jobs: { queue: 'analytics' },
			}),
		})
	}, 240_000)

	afterAll(async () => {
		await settleRetiredRuntimes(booted.payload)
		await booted.stop()
	})

	it(`registers each collection under its own slug and none under a default on ${db}`, () => {
		const registered = Object.keys(booted.payload.collections)
		for (const slug of Object.values(SLUGS)) {
			expect(registered).toContain(slug)
		}
		for (const slug of DEFAULT_SLUGS) {
			expect(registered).not.toContain(slug)
		}
		if (db !== 'mongo') {
			const tables: unknown = Reflect.get(booted.payload.db, 'tableNameMap')
			expect(tables instanceof Map ? tables.get('site_hits') : undefined).toBe('raw_hits')
		}
	})

	it(`ingests into the renamed hits, completing a goal of the renamed goals, on ${db}`, async () => {
		const { payload } = booted
		await payload.create({
			collection: SLUGS.goals as CollectionSlug,
			data: {
				name: 'Signup',
				slug: 'signup',
				match: { kind: 'path', pattern: '/signup' },
			} as never,
		})
		expect((await postBeacon(payload, { type: 'pageview', path: '/signup' })).status).toBe(202)
		await trackServerEvent(payload, { type: 'pageview', path: '/server', hostname: INGEST_HOST })
		expect(await countIn(payload, SLUGS.hits)).toBe(2)
		const read = await nativeOf(payload).engine.read({
			metrics: ['pageviews', 'conversions'],
			hostname: INGEST_HOST,
			dateRange: aroundNow(),
		})
		expect(read.totals).toMatchObject({ pageviews: 2, conversions: 1 })
	})

	it(`counts closed days into the renamed aggregates through the maintain job on ${db}`, async () => {
		const { payload } = booted
		const today = calendarDayOf(new Date())
		const days = [addCalendarDays(today, -3), addCalendarDays(today, -2)]
		// Whatever an earlier read started in the background settles first.
		await nativeOf(payload).engine.idle()
		// Server events in the past: each marks its closed day for counting again.
		for (const [index, day] of days.entries()) {
			for (let visit = 0; visit <= index; visit++) {
				await trackServerEvent(payload, {
					type: 'pageview',
					path: '/closed',
					hostname: 'closed.example',
					now: new Date(calendarDayStart(day).getTime() + (60 + visit) * 60_000),
				})
			}
		}
		await nativeOf(payload).engine.idle()
		await runTasks(payload, [TASK_SLUGS.maintain])
		expect(await countIn(payload, SLUGS.aggregates)).toBeGreaterThan(0)
		const markers = await nativeOf(payload).state.markers('', days[0] ?? 0, days[1] ?? 0)
		expect(markers.map((marker) => marker.day)).toEqual(days)
		const read = await nativeOf(payload).engine.read({
			metrics: ['pageviews'],
			hostname: 'closed.example',
			granularity: 'day',
			dateRange: {
				start: calendarDayStart(days[0] ?? 0),
				end: new Date(calendarDayStart(addCalendarDays(days[1] ?? 0, 1)).getTime() - 1),
			},
		})
		expect(read.rows.map((row) => row.metrics.pageviews)).toEqual([1, 2])
	})

	it(`caches a read in the renamed cache collection and warms it on ${db}`, async () => {
		const { payload } = booted
		const read = await readForWidget({
			req: readerRequest(payload),
			metrics: ['pageviews'],
			timeframe: 'last7days',
			adapterId: 'memory',
			now: new Date(),
		})
		expect(read.status).toBe('ok')
		await getRuntime(payload)?.engine.idle?.()
		await getRuntime(payload)?.cache?.sweeper.idle()
		expect(await countIn(payload, SLUGS.cache)).toBeGreaterThan(0)
		await runTasks(payload, [TASK_SLUGS.warm])
	})

	it(`syncs into the renamed sync collection, its lease and heartbeat in the renamed state, on ${db}`, async () => {
		const { payload } = booted
		await runTasks(payload, [TASK_SLUGS.sync])
		expect(await countIn(payload, SLUGS.sync)).toBe(2)
		expect(await stateStoreOf(payload)?.lastBeat(TASK_SLUGS.sync)).toBeInstanceOf(Date)
		const beat = await payload.db.findOne({
			collection: SLUGS.state as CollectionSlug,
			req: {},
			where: { id: { equals: heartbeatKey(TASK_SLUGS.sync) } },
		})
		expect(beat).not.toBeNull()
	})

	it(`resolves a provider document from the renamed providers collection on ${db}`, async () => {
		const { payload } = booted
		const created = await payload.create({
			collection: SLUGS.providers as CollectionSlug,
			data: {
				name: 'Plausible',
				provider: 'plausible',
				enabled: true,
				plausible: { siteId: 'example.com', apiKey: 'plausible-key' },
			} as never,
			overrideAccess: true,
		})
		const runtime = getRuntime(payload)
		if (!runtime) {
			throw new Error('runtime missing')
		}
		const { registry } = await resolveRegistryFor(runtime, { payload, scope: null })
		expect(registry.all().map((adapter) => adapter.id)).toContain(`plausible:${created.id}`)
	})

	it(`warns at init that an override reopened the cache's read access on ${db}`, async () => {
		const { payload } = booted
		const warn = vi.spyOn(payload.logger, 'warn')
		try {
			await runtimeFactoryOf(payload.config)?.validate(payload)
			expect(warn).toHaveBeenCalledWith(
				expect.stringContaining(
					`cache.collection.overrides, on the "${SLUGS.cache}" collection, replaced the plugin's read access.`
				)
			)
		} finally {
			warn.mockRestore()
		}
	})
})

describeForDb('analytics without native() and its state renamed', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			plugin: analytics({
				adapters: [vendorSource()],
				capture: { gate: 'off' },
				sync: { collection: { slug: 'vendor-daily' } },
				jobs: { queue: 'analytics', state: { slug: 'task-state' } },
			}),
		})
	}, 240_000)

	afterAll(async () => {
		await settleRetiredRuntimes(booted.payload)
		await booted.stop()
	})

	it(`keeps the sync task's lease and heartbeat in jobs.state on ${db}`, async () => {
		const { payload } = booted
		expect(Object.hasOwn(payload.collections, 'task-state')).toBe(true)
		expect(Object.hasOwn(payload.collections, 'analytics-state')).toBe(false)
		await runTasks(payload, [TASK_SLUGS.sync])
		expect(await countIn(payload, 'vendor-daily')).toBe(2)
		expect(await stateStoreOf(payload)?.lastBeat(TASK_SLUGS.sync)).toBeInstanceOf(Date)
		expect(await countIn(payload, 'task-state')).toBeGreaterThan(0)
	})
})
