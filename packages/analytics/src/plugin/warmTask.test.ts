import type { Payload, PayloadRequest } from 'payload'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnalyticsQuery } from '../core/contract'
import { createRegistry } from '../core/registry'
import type { ReadRecipe } from '../surfacing/cacheStore'
import type { RefreshOptions, RefreshOutcome } from '../surfacing/engine'
import { recipeWindow } from '../surfacing/recipe'
import { memoryAdapter } from '../testing/memoryAdapter'
import { memoryCacheStore } from '../testing/memoryCacheStore'
import type { AnalyticsRuntime } from './runtime'
import { setRuntime } from './runtime'
import {
	takeInTurn,
	WARM_TASK_SLUG,
	type WarmTaskOptions,
	type WarmTaskOutput,
	warmTask,
} from './warmTask'

const NOW = new Date('2026-10-07T23:30:00.000Z')
const HOUR = 3_600_000

const recipe = (overrides: Partial<ReadRecipe> = {}): ReadRecipe => ({
	adapterRef: 'memory',
	scope: null,
	timeframe: 'last7days',
	window: 'live',
	query: { metrics: ['pageviews'], timezone: 'UTC' },
	...overrides,
})

interface Refresh {
	adapterId: string
	query: AnalyticsQuery
	options: RefreshOptions
}

const setup = (
	recipes: ReadRecipe[],
	answer: (query: AnalyticsQuery) => RefreshOutcome,
	extra: Partial<WarmTaskOptions> = {}
) => {
	const warn = vi.fn()
	const payload = { config: {}, collections: {}, logger: { warn } } as unknown as Payload
	const store = memoryCacheStore()
	const recent = vi.spyOn(store, 'recentRecipes').mockResolvedValue(recipes)
	const refreshes: Refresh[] = []
	const tenantSource = { ...memoryAdapter(), id: 'plausible:doc-a' }
	const runtime: AnalyticsRuntime = {
		registry: createRegistry([memoryAdapter()]),
		resolveRegistry: async ({ scope }) => ({
			registry: createRegistry(scope === 'tenant-a' ? [tenantSource] : [memoryAdapter()]),
			grants: new Map(),
		}),
		resolveTimezone: async (_req, scope) => (scope === 'tenant-a' ? 'Europe/Berlin' : 'UTC'),
		configAdapterIds: new Set(['memory']),
		bindings: {},
		ttl: {},
		comparison: true,
		cache: {
			store,
			sweeper: {
				maybeSweep: () => undefined,
				sweep: async () => ({ ran: true, swept: 0 }),
				idle: async () => undefined,
			},
		},
		engine: {
			read: async () => {
				throw new Error('the warm task refreshes, it never reads')
			},
			refresh: async (adapter, query, options) => {
				refreshes.push({ adapterId: adapter.id, query, options })
				const outcome = answer(query)
				if (outcome === 'refreshed' && query.metrics.includes('visits')) {
					throw new Error('vendor down')
				}
				return outcome
			},
		},
	}
	setRuntime(payload, runtime)
	const task = warmTask({
		schedule: { queue: 'analytics', cron: '*/30 * * * *', intervalMs: 30 * 60_000 },
		windowHours: 6,
		maxReads: 50,
		...extra,
	})
	const run = async (): Promise<WarmTaskOutput> => {
		const handler = task.handler
		if (typeof handler !== 'function') {
			throw new Error('the warm task runs a function')
		}
		const result = await handler({ req: { payload } as PayloadRequest } as never)
		if (!('output' in result) || !result.output) {
			throw new Error('the warm task answers an output')
		}
		return result.output
	}
	return { run, refreshes, recent, warn, payload }
}

describe('takeInTurn', () => {
	it('takes one recipe of each scope per round, most recently read first, up to the limit', () => {
		const a1 = recipe({ scope: 'a', window: 'live' })
		const a2 = recipe({ scope: 'a', window: 'days' })
		const a3 = recipe({ scope: 'a', window: 'previous' })
		const b1 = recipe({ scope: 'b' })
		const none = recipe({ scope: null })
		expect(takeInTurn([a1, a2, b1, a3, none], 10)).toEqual([a1, b1, none, a2, a3])
		expect(takeInTurn([a1, a2, b1, a3, none], 2)).toEqual([a1, b1])
		expect(takeInTurn([], 3)).toEqual([])
	})
})

describe('warmTask', () => {
	beforeEach(() => {
		vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it('is analytics-warm, on its queue, behind the stuck-job guard', () => {
		const task = warmTask({
			schedule: { queue: 'analytics', cron: '*/30 * * * *', intervalMs: 30 * 60_000 },
			windowHours: 24,
			maxReads: 200,
		})
		expect(task.slug).toBe(WARM_TASK_SLUG)
		expect(task.slug).toBe('analytics-warm')
		expect(task.schedule).toMatchObject([{ cron: '*/30 * * * *', queue: 'analytics' }])
		expect(task.concurrency).toBeUndefined()
	})

	it('marks its own killed runs failed, unless a live run holds its lease', async () => {
		const hook = warmTask({
			schedule: { queue: 'analytics', cron: '*/30 * * * *', intervalMs: 30 * 60_000 },
			windowHours: 24,
			maxReads: 200,
		}).schedule?.[0]?.hooks?.beforeSchedule
		const updateJobs = vi.fn(async () => null)
		const payload = { collections: {}, db: { updateJobs } } as unknown as Payload
		await hook?.({
			defaultBeforeSchedule: async () => ({ input: {}, shouldSchedule: true }),
			jobStats: {},
			queueable: { scheduleConfig: { cron: '*/30 * * * *', queue: 'analytics' } },
			req: { payload } as PayloadRequest,
		} as never)
		const [update] = updateJobs.mock.calls[0] as unknown as [
			{ where: { and: Array<Record<string, Record<string, unknown>>> } },
		]
		expect(update.where.and).toContainEqual({ taskSlug: { equals: 'analytics-warm' } })
		expect(update.where.and).toContainEqual({ queue: { equals: 'analytics' } })
	})

	it('asks the store for four times maxReads of the last windowHours’ reads, to pick from', async () => {
		const { run, recent } = setup([], () => 'fresh')
		await run()
		expect(recent).toHaveBeenCalledWith(new Date(NOW.getTime() - 6 * HOUR), 200)
	})

	it('takes maxReads recipes in turn from each scope, so a busy scope never takes every place', async () => {
		const busy = Array.from({ length: 5 }, (_, i) =>
			recipe({ query: { metrics: ['pageviews'], timezone: 'UTC', path: `/busy-${i}` } })
		)
		const quiet = recipe({
			adapterRef: 'plausible:doc-a',
			scope: 'tenant-a',
			query: { metrics: ['pageviews'], timezone: 'Europe/Berlin', scope: 'tenant-a' },
		})
		const { run, refreshes } = setup([...busy, quiet], () => 'refreshed', { maxReads: 3 })
		expect(await run()).toMatchObject({ ran: true, finished: true, refreshed: 3 })
		expect(refreshes.map((each) => each.query.path ?? each.query.scope)).toEqual([
			'/busy-0',
			'tenant-a',
			'/busy-1',
		])
	})

	it('stops between reads once its budget is spent, saying it did not finish', async () => {
		let wall = 0
		const { run, refreshes } = setup(
			[recipe(), recipe({ window: 'days' }), recipe({ window: 'previous' })],
			() => {
				wall += 600
				return 'refreshed'
			},
			{ budgetMs: 1_000, clock: () => wall }
		)
		expect(await run()).toMatchObject({ ran: true, finished: false, refreshed: 2 })
		expect(refreshes).toHaveLength(2)
	})

	it('works out each window now, in its own scope’s zone, through that scope’s sources', async () => {
		const tenant = recipe({
			adapterRef: 'plausible:doc-a',
			scope: 'tenant-a',
			window: 'days',
			query: { metrics: ['pageviews'], timezone: 'Europe/Berlin', scope: 'tenant-a' },
		})
		const { run, refreshes } = setup([recipe(), tenant], () => 'refreshed')
		expect(await run()).toEqual({
			ran: true,
			finished: true,
			refreshed: 2,
			fresh: 0,
			skipped: 0,
			failed: 0,
		})
		expect(refreshes).toEqual([
			{
				adapterId: 'memory',
				query: {
					metrics: ['pageviews'],
					timezone: 'UTC',
					dateRange: recipeWindow({ timeframe: 'last7days', window: 'live' }, NOW, 'UTC'),
				},
				options: { freshForMs: 30 * 60_000, priority: 'background' },
			},
			{
				adapterId: 'plausible:doc-a',
				query: {
					metrics: ['pageviews'],
					timezone: 'Europe/Berlin',
					scope: 'tenant-a',
					dateRange: recipeWindow({ timeframe: 'last7days', window: 'days' }, NOW, 'Europe/Berlin'),
				},
				options: { freshForMs: 30 * 60_000, priority: 'background' },
			},
		])
		// 23:30 UTC is already the next day in Berlin, so the two windows end on different days.
		expect(refreshes[1]?.query.dateRange.end.toISOString()).toBe('2026-10-08T21:59:59.999Z')
	})

	it('counts what it left fresh, what it passed over and what failed, warning once per source', async () => {
		const { run, warn } = setup(
			[
				recipe(),
				recipe({ query: { metrics: ['visits'], timezone: 'UTC' } }),
				recipe({ query: { metrics: ['visits'], path: '/a', timezone: 'UTC' } }),
				recipe({ adapterRef: 'gone' }),
				recipe({ timeframe: 'allTime', window: 'previous' }),
			],
			(query) => (query.metrics.includes('visits') ? 'refreshed' : 'fresh')
		)
		expect(await run()).toEqual({
			ran: true,
			finished: true,
			refreshed: 0,
			fresh: 1,
			skipped: 2,
			failed: 2,
		})
		expect(warn).toHaveBeenCalledTimes(1)
		expect(warn.mock.calls[0]?.[0]).toMatch(
			/analytics warm: a read from "memory" .* failed: .*vendor down/
		)
	})

	it('runs nothing on an instance whose runtime keeps no read cache', async () => {
		const payload = { config: {}, collections: {}, logger: { warn: vi.fn() } } as unknown as Payload
		setRuntime(payload, {
			registry: createRegistry([memoryAdapter()]),
			configAdapterIds: new Set(),
			bindings: {},
			ttl: {},
			comparison: true,
			engine: { read: async () => ({ rows: [], meta: { provider: 'memory', fetchedAt: '' } }) },
		})
		const handler = warmTask({
			schedule: { queue: 'default', cron: null, intervalMs: 1 },
			windowHours: 1,
			maxReads: 1,
		}).handler
		if (typeof handler !== 'function') {
			throw new Error('the warm task runs a function')
		}
		expect(await handler({ req: { payload } as PayloadRequest } as never)).toEqual({
			output: { ran: false, finished: false, refreshed: 0, fresh: 0, skipped: 0, failed: 0 },
		})
	})
})
