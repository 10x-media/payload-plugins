import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import {
	buildConfig,
	type CollectionConfig,
	type Config,
	handleEndpoints,
	type Plugin,
	reload,
	type WidgetInstance,
} from 'payload'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import type { AnalyticsAdapter } from '../../src/core/contract'
import { analytics } from '../../src/index'
import { trackServerEvent } from '../../src/native/ingest/serverTrack'
import { native } from '../../src/native/nativeAdapter'
import { MAINTAIN_TASK_SLUG } from '../../src/native/tasks/maintainTask'
import { DEFAULT_ROUTE_BASE, routePaths } from '../../src/plugin/routes'
import { getRuntime, runtimeFactoryOf, settleRetiredRuntimes } from '../../src/plugin/runtime'
import { WARM_TASK_SLUG } from '../../src/plugin/warmTask'
import type { QueryResponse } from '../../src/query/response'
import { SYNC_TASK_SLUG } from '../../src/sync/syncTask'
import { memoryAdapter } from '../../src/testing/memoryAdapter'
import { countHits } from './nativeHelpers'

const routes = routePaths(DEFAULT_ROUTE_BASE)

const RUNTIME_KEY = Symbol.for('@10x-media/analytics/runtime')

const users: CollectionConfig = { slug: 'lazy-users', auth: true, fields: [] }

/** One analytics widget, so the warm task has a read to run rather than nothing. */
const layout: WidgetInstance[] = [
	{
		widgetSlug: 'analytics-metric',
		width: 'small',
		data: { metric: 'pageviews', timeframe: 'last30days' },
	},
]

/** A memory source whose `close` can be watched, as a vendor client's would be. */
const closableMemory = () => Object.assign(memoryAdapter(), { close: vi.fn(async () => undefined) })

/** Every surface the runtime feeds: reads, native ingest, and all three tasks. */
const pluginFor = (adapters: AnalyticsAdapter[]): Plugin =>
	analytics({
		adapters,
		defaultAdapter: 'memory',
		capture: { gate: 'off' },
		cache: { warm: true },
		sync: true,
	})

/** Yesterday and today in UTC, so a pageview recorded at boot stays in range past midnight. */
const lastTwoDays = (): string => {
	const now = Date.now()
	const day = (at: number) => new Date(at).toISOString().slice(0, 10)
	return `from=${day(now - 86_400_000)}&to=${day(now)}`
}

describeForDb('analytics runtime without onInit', {}, (db) => {
	const mem = closableMemory()
	const engine = native()
	let booted: BootedPayload
	let token = ''

	/** A signed-in read through Payload's own REST router, which is what proves the mount. */
	const query = async (metric: 'pageviews' | 'visitors'): Promise<Response> =>
		handleEndpoints({
			config: booted.payload.config,
			payloadInstanceCacheKey: booted.cacheKey,
			request: new Request(
				`http://localhost:3000/api${routes.query}?metrics=${metric}&${lastTwoDays()}`,
				{ headers: { cookie: `payload-token=${token}` } }
			),
		})

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			collections: [users],
			disableOnInit: true,
			plugin: pluginFor([mem, engine]),
			configOverrides: {
				admin: {
					importMap: { autoGenerate: false },
					dashboard: { widgets: [], defaultLayout: layout },
				},
			},
		})
		mem.record({ path: '/lazy', timestamp: new Date(), visitor: 'v1' })
		const credentials = { email: 'reader@lazy.dev', password: 'test-pass-1234' }
		await booted.payload.create({ collection: 'lazy-users', data: credentials })
		token =
			(await booted.payload.login({ collection: 'lazy-users', data: credentials })).token ?? ''
	}, 240_000)

	afterAll(async () => {
		await settleRetiredRuntimes(booted.payload)
		await booted.stop()
	})

	it(`boots with no runtime, since nothing ran onInit, on ${db}`, () => {
		expect(Reflect.get(booted.payload, RUNTIME_KEY)).toBeUndefined()
	})

	it(`serves a query read through the REST router at the new mount on ${db}`, async () => {
		const res = await query('pageviews')
		expect(res.status).toBe(200)
		const body = (await res.json()) as QueryResponse
		expect(body.source.id).toBe('memory')
		expect(body.result.totals?.pageviews).toBe(1)
		const [first, second] = getRuntime(booted.payload)?.adapters ?? []
		expect(first).toBe(mem)
		expect(second).toBe(engine)
	})

	it(`accepts trackServerEvent and stores the event on ${db}`, async () => {
		await trackServerEvent(booted.payload, {
			type: 'pageview',
			path: '/lazy-server',
			hostname: 'lazy.example',
		})
		expect(await countHits(booted.payload, { path: { equals: '/lazy-server' } })).toBe(1)
	})

	it(`reads the tracked event back through native on ${db}`, async () => {
		const read = await engine.query(
			{
				path: '/lazy-server',
				hostname: 'lazy.example',
				metrics: ['pageviews'],
				dateRange: { start: new Date(Date.now() - 86_400_000), end: new Date(Date.now() + 60_000) },
			},
			{ payload: booted.payload }
		)
		expect(read.totals?.pageviews).toBe(1)
	})

	it(`accepts a beacon at the new ingest mount on ${db}`, async () => {
		const res = await handleEndpoints({
			config: booted.payload.config,
			payloadInstanceCacheKey: booted.cacheKey,
			request: new Request(`http://localhost:3000/api${routes.ingest}`, {
				method: 'POST',
				body: JSON.stringify({ type: 'pageview', path: '/lazy-beacon' }),
				headers: {
					'content-type': 'application/json',
					'user-agent': 'Mozilla/5.0 (Macintosh) Firefox/126.0',
					host: 'lazy.example',
				},
			}),
		})
		expect(res.status).toBe(202)
		expect(await countHits(booted.payload, { path: { equals: '/lazy-beacon' } })).toBe(1)
	})

	it(`runs every plugin task through the jobs queue on ${db}`, async () => {
		const queued = []
		for (const task of [WARM_TASK_SLUG, SYNC_TASK_SLUG, MAINTAIN_TASK_SLUG]) {
			queued.push([task, (await booted.payload.jobs.queue({ task, input: {} })).id] as const)
		}
		const run = await booted.payload.jobs.run()
		for (const [task, id] of queued) {
			expect(run.jobStatus?.[String(id)]?.status, task).toBe('success')
		}
		// The sync task wrote the memory source's day, which only a runtime could have read.
		const { totalDocs } = await booted.payload.count({ collection: 'analytics-daily' as never })
		expect(totalDocs).toBeGreaterThan(0)
	})

	it(`rebuilds the runtime on reload and closes the adapters it replaced on ${db}`, async () => {
		const retired = getRuntime(booted.payload)
		const nativeClose = vi.spyOn(engine, 'close')
		const nextMem = closableMemory()
		const nextEngine = native()
		nextMem.record({ path: '/lazy', timestamp: new Date(), visitor: 'v1' })
		nextMem.record({ path: '/lazy', timestamp: new Date(), visitor: 'v2' })
		const next = await buildConfig({
			secret: 'test-secret-not-for-prod',
			db: booted.payload.config.db,
			collections: [users],
			typescript: { autoGenerate: false, outputFile: '/dev/null' },
			admin: {
				importMap: { autoGenerate: false },
				dashboard: { widgets: [], defaultLayout: layout },
			},
			telemetry: false,
			plugins: [pluginFor([nextMem, nextEngine])],
		})
		await reload(next, booted.payload, true)

		const rebuilt = getRuntime(booted.payload)
		expect(rebuilt).not.toBe(retired)
		const [first, second] = rebuilt?.adapters ?? []
		expect(first).toBe(nextMem)
		expect(second).toBe(nextEngine)
		expect(mem.close).not.toHaveBeenCalled()

		await settleRetiredRuntimes(booted.payload)
		expect(mem.close).toHaveBeenCalledTimes(1)
		expect(nativeClose).toHaveBeenCalledTimes(1)
		expect(nextMem.close).not.toHaveBeenCalled()

		// Not the pageviews read from before the reload: that one is cached in the database's KV,
		// which both runtimes share, so only a read nothing has cached reaches the new source.
		const res = await query('visitors')
		expect(res.status).toBe(200)
		expect(((await res.json()) as QueryResponse).result.totals?.visitors).toBe(2)
	})
})

describeForDb('analytics route collision at boot', {}, (db) => {
	let booted: BootedPayload

	/** A plugin running after analytics that brings a collection named like the base. */
	const shadowing: Plugin = (config) => ({
		...config,
		collections: [...(config.collections ?? []), { slug: '_x', fields: [] }],
	})

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			disableOnInit: true,
			plugin: analytics({ adapters: [memoryAdapter()] }),
			configOverrides: { plugins: [shadowing] },
		})
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	it(`refuses a host collection declared under the base before the plugin runs on ${db}`, async () => {
		const host: Config = {
			secret: 'test-secret-not-for-prod',
			db: booted.payload.config.db,
			collections: [{ slug: '_x', fields: [] }],
			plugins: [analytics({ adapters: [memoryAdapter()] })],
		}
		await expect(buildConfig(host)).rejects.toThrow(
			/"_x" collection's slug is the first segment of routes\.base "\/_x".*Set routes\.base/
		)
	})

	it(`fails the boot's onInit for a collection a later plugin adds under the base on ${db}`, async () => {
		await expect(booted.payload.config.onInit?.(booted.payload)).rejects.toThrow(
			/"_x" collection's slug is the first segment of routes\.base "\/_x"/
		)
		await expect(runtimeFactoryOf(booted.payload.config)?.validate(booted.payload)).rejects.toThrow(
			/routes\.base/
		)
	})

	it(`refuses to build the runtime of a worker booted without onInit on ${db}`, () => {
		expect(() => getRuntime(booted.payload)).toThrow(
			/"_x" collection's slug is the first segment of routes\.base "\/_x"/
		)
	})
})

describeForDb('analytics collections a later plugin changed', {}, (db) => {
	let booted: BootedPayload

	/** A plugin running after analytics that replaces `custom` on every collection with its own. */
	const stamping: Plugin = (config) => ({
		...config,
		collections: (config.collections ?? []).map((collection) => ({
			...collection,
			custom: { stamped: true },
		})),
	})

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			disableOnInit: true,
			plugin: analytics({ adapters: [memoryAdapter()] }),
			configOverrides: { plugins: [stamping] },
		})
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	it(`fails onInit and the runtime build, naming the collection, on ${db}`, async () => {
		const message =
			/a plugin that runs after analytics, on the "analytics-cache" collection \(cache\.collection\), replaced the collection's custom/
		await expect(booted.payload.config.onInit?.(booted.payload)).rejects.toThrow(message)
		expect(() => getRuntime(booted.payload)).toThrow(message)
	})
})
