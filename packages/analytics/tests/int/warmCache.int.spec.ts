import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { PayloadRequest, WidgetInstance } from 'payload'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { analytics } from '../../src/index'
import { flushBatch } from '../../src/native/ingest/flushBatch'
import type { StoredEvent } from '../../src/native/ingest/normalizeEvent'
import { native } from '../../src/native/nativeAdapter'
import { getRuntime } from '../../src/plugin/runtime'
import { WARM_TASK_SLUG, warmTask } from '../../src/plugin/warmTask'
import { readForWidget } from '../../src/widgets/readForWidget'

interface RegisteredTask {
	slug?: string
	schedule?: Array<{ cron?: string }>
}

const layout: WidgetInstance[] = [
	{
		widgetSlug: 'analytics-metric',
		width: 'small',
		data: { metric: 'pageviews', timeframe: 'last30days' },
	},
	{
		widgetSlug: 'analytics-breakdown-pages',
		width: 'medium',
		data: { metric: 'pageviews', timeframe: 'last30days', limit: 5 },
	},
	{
		widgetSlug: 'analytics-realtime',
		width: 'small',
		data: { metric: 'visitors', windowMinutes: 30 },
	},
]

describeForDb('analytics scheduled warm-cache', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: analytics({ adapters: [native()], cache: { warm: true } }),
			db,
			configOverrides: {
				admin: {
					importMap: { autoGenerate: false },
					dashboard: { widgets: [], defaultLayout: layout },
				},
			},
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	const reqOf = (): PayloadRequest => ({ payload: booted.payload }) as unknown as PayloadRequest

	it('registers the warm-cache task with the configured cron schedule', () => {
		const tasks =
			(booted.payload.config as unknown as { jobs?: { tasks?: RegisteredTask[] } }).jobs?.tasks ??
			[]
		const task = tasks.find((t) => t.slug === WARM_TASK_SLUG)
		expect(task).toBeDefined()
		expect(task?.schedule?.[0]?.cron).toBe('*/30 * * * *')
	})

	it('warms the dashboard reads, and a warmed tuple is then served from cache', async () => {
		const event: StoredEvent = {
			timestamp: new Date(Date.now() - 86_400_000),
			type: 'pageview',
			path: '/p',
			hostname: 'h',
			visitorHash: 'v1',
			sessionId: 'v1',
		}
		await flushBatch(booted.payload, [event])

		const task = warmTask('*/30 * * * *', layout)
		const handler = task.handler
		if (typeof handler !== 'function') {
			throw new Error('warm task handler must be a function')
		}
		const result = await handler({ req: reqOf() } as unknown as Parameters<typeof handler>[0])
		const output = (result as { output: { warmed: number; failed: number } }).output
		expect(output.failed).toBe(0)
		expect(output.warmed).toBeGreaterThan(0)

		// The warm run populated the cache under the day-snapped key; a live read for the
		// same metric tuple must hit it without calling the adapter again.
		const adapter = getRuntime(booted.payload)?.registry.default()
		if (!adapter) {
			throw new Error('runtime adapter missing after boot')
		}
		const spy = vi.spyOn(adapter, 'query')
		const live = await readForWidget({
			req: reqOf(),
			metrics: ['pageviews'],
			timeframe: 'last30days',
			now: new Date(),
		})
		expect(live.status).toBe('ok')
		expect(live.metrics.pageviews).toBe(1)
		expect(spy).not.toHaveBeenCalled()
	})

	it('returns 0/0 without throwing when the layout function throws', async () => {
		const task = warmTask('*/30 * * * *', () => {
			throw new Error('boom')
		})
		const handler = task.handler
		if (typeof handler !== 'function') {
			throw new Error('warm task handler must be a function')
		}
		const result = await handler({ req: reqOf() } as unknown as Parameters<typeof handler>[0])
		expect((result as { output: { warmed: number; failed: number } }).output).toEqual({
			warmed: 0,
			failed: 0,
		})
	})
})
