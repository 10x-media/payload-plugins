import {
	type BootedPayload,
	bootPayload,
	describeForDb,
	installTestClock,
	type TestClock,
} from '@10x-media/payload-test-harness'
import type { Endpoint, PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { analytics } from '../../src/index'
import { native } from '../../src/native/nativeAdapter'
import { DEFAULT_ROUTE_BASE, routePaths } from '../../src/plugin/routes'
import { getRuntime } from '../../src/plugin/runtime'
import { WARM_TASK_SLUG, type WarmTaskOutput, warmTask } from '../../src/plugin/warmTask'
import type { CacheStore, ReadRecipe } from '../../src/surfacing/cacheStore'
import { memoryAdapter } from '../../src/testing/memoryAdapter'
import { resolveTimeframe } from '../../src/timeframe/presets'
import { zonedCalendarDay } from '../../src/timeframe/tz'
import { readForWidget } from '../../src/widgets/readForWidget'
import { readerRequest } from './readerRequest'

const routes = routePaths(DEFAULT_ROUTE_BASE)

const MINUTE = 60_000

/** The view's request for `last30days` at `at`: its first and last calendar day in UTC. */
const viewDays = (at: Date): string => {
	const window = resolveTimeframe('last30days', at, 'UTC')
	return `from=${zonedCalendarDay(window.start, 'UTC')}&to=${zonedCalendarDay(window.end, 'UTC')}`
}

interface RegisteredTask {
	slug?: string
	schedule?: Array<{ cron?: string; queue?: string }>
}

describeForDb('analytics warm task', {}, (db) => {
	let booted: BootedPayload
	let clock: TestClock
	const vendor = memoryAdapter()

	beforeAll(async () => {
		// Far from the wall clock, so a read that took its "now" from anywhere but Payload's clock
		// would store no recipe for its timeframe.
		clock = installTestClock(new Date('2026-03-10T12:00:00.000Z'))
		vendor.record({ path: '/pricing', timestamp: new Date(Date.now() - 2 * 86_400_000) })
		booted = await bootPayload({
			plugin: analytics({
				adapters: [vendor, native()],
				defaultAdapter: 'memory',
				capture: { gate: 'off' },
				cache: { warm: { windowHours: 24, maxReads: 50 } },
				jobs: { queue: 'analytics' },
				collections: { pages: { pathField: 'slug' } },
			}),
			db,
			collections: [{ slug: 'pages', fields: [{ name: 'slug', type: 'text' }] }],
		})
	}, 240_000)

	afterAll(async () => {
		clock.reset()
		await booted.stop()
	})

	const storeOf = (): CacheStore => {
		const store = getRuntime(booted.payload)?.cache?.store
		if (!store) {
			throw new Error('runtime read cache missing after boot')
		}
		return store
	}

	const recipes = async (): Promise<ReadRecipe[]> =>
		storeOf().recentRecipes(new Date(clock.now().getTime() - 3_600_000), 50)

	const endpoint = async (path: string, query: string): Promise<Response> => {
		const found = (booted.payload.config.endpoints ?? []).find(
			(each): each is Endpoint => typeof each === 'object' && each.path === path
		)
		if (!found || typeof found.handler !== 'function') {
			throw new Error(`${path} is not registered`)
		}
		return found.handler(
			readerRequest(booted.payload, { url: `http://localhost/api${path}?${query}` })
		)
	}

	const runWarm = async (): Promise<WarmTaskOutput> => {
		const handler = warmTask({
			schedule: { queue: 'analytics', cron: '*/30 * * * *', intervalMs: 30 * MINUTE },
			windowHours: 24,
			maxReads: 50,
		}).handler
		if (typeof handler !== 'function') {
			throw new Error('warm task handler must be a function')
		}
		const result = await handler({
			req: { payload: booted.payload } as PayloadRequest,
		} as unknown as Parameters<typeof handler>[0])
		if (!('output' in result) || !result.output) {
			throw new Error('the warm task answers an output')
		}
		return result.output
	}

	it(`registers analytics-warm on the jobs queue at its default schedule on ${db}`, () => {
		const tasks =
			(booted.payload.config as unknown as { jobs?: { tasks?: RegisteredTask[] } }).jobs?.tasks ??
			[]
		const task = tasks.find((each) => each.slug === WARM_TASK_SLUG)
		expect(task?.schedule).toEqual([
			expect.objectContaining({ cron: '*/30 * * * *', queue: 'analytics' }),
		])
	})

	it(`records how to repeat a widget's, the view's and the panel's reads on ${db}`, async () => {
		const widget = await readForWidget({
			req: readerRequest(booted.payload),
			metrics: ['pageviews'],
			timeframe: 'last7days',
			now: clock.now(),
		})
		expect(widget.status).toBe('ok')
		const view = await endpoint(
			routes.query,
			`metrics=visitors&${viewDays(clock.now())}&timeframe=last30days&compare=previous&timezone=UTC`
		)
		expect(view.status).toBe(200)
		const page = await booted.payload.create({
			collection: 'pages' as never,
			data: { slug: 'pricing' } as never,
		})
		const panel = await endpoint(
			routes.document,
			`collection=pages&id=${String((page as { id: string | number }).id)}&metrics=sessions&timeframe=last90days`
		)
		expect(panel.status).toBe(200)
		// Each answer and its recipe are written in the background, after the read answered.
		await getRuntime(booted.payload)?.engine.idle?.()
		const recorded = await recipes()
		const pick = (metric: string) =>
			recorded
				.filter((recipe) => recipe.query.metrics.includes(metric as never))
				.map((recipe) => [recipe.timeframe, recipe.window])
		expect(pick('pageviews')).toEqual(expect.arrayContaining([['last7days', 'live']]))
		expect(pick('visitors')).toEqual(
			expect.arrayContaining([
				['last30days', 'days'],
				['last30days', 'previous'],
			])
		)
		expect(pick('sessions')).toEqual(expect.arrayContaining([['last90days', 'live']]))
		expect(recorded.every((recipe) => recipe.adapterRef === 'memory')).toBe(true)
	})

	it(`refreshes only the recent reads whose entry expires before its next run on ${db}`, async () => {
		const query = vi.spyOn(vendor, 'query')
		const recorded = (await recipes()).length
		const first = await runWarm()
		expect(first).toMatchObject({ ran: true, refreshed: 0, failed: 0 })
		expect(first.fresh).toBeGreaterThan(0)
		expect(query).not.toHaveBeenCalled()

		// The memory source's answers stay fresh for an hour: 40 minutes on, each expires before the
		// next run half an hour away.
		clock.advance(40 * MINUTE)
		const second = await runWarm()
		expect(second).toMatchObject({ ran: true, fresh: 0, failed: 0, refreshed: first.fresh })
		expect(query).toHaveBeenCalledTimes(first.fresh)
		// A refresh leaves each entry's recipe and read time as the reader left them.
		expect(await recipes()).toHaveLength(recorded)

		query.mockClear()
		const again = await readForWidget({
			req: readerRequest(booted.payload),
			metrics: ['pageviews'],
			timeframe: 'last7days',
			now: clock.now(),
		})
		expect(again.status).toBe('ok')
		expect(query).not.toHaveBeenCalled()
		query.mockRestore()
	})

	it(`lets reads nobody asked for in windowHours go cold on ${db}`, async () => {
		clock.advance(25 * 60 * MINUTE)
		expect(await runWarm()).toEqual({
			ran: true,
			finished: true,
			refreshed: 0,
			fresh: 0,
			skipped: 0,
			failed: 0,
		})
	})
})
