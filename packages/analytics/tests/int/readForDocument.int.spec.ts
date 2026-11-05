import {
	type BootedPayload,
	bootPayload,
	describeForDb,
	installTestClock,
	type TestClock,
} from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import type { MetricKey } from '../../src/core/contract'
import { readForField } from '../../src/fields/readForDocument'
import { analytics } from '../../src/index'
import { native } from '../../src/native/nativeAdapter'
import { ingestDirect } from './nativeHelpers'
import { readerRequest } from './readerRequest'

describeForDb('analytics readForField', {}, (db) => {
	let booted: BootedPayload
	let clock: TestClock

	beforeAll(async () => {
		// Held still: two pageviews count as one visitor only on one day's salt.
		clock = installTestClock(new Date())
		booted = await bootPayload({
			plugin: analytics({
				adapters: [native()],
				capture: { gate: 'off' },
				collections: { pages: { path: (doc) => (doc.slug as string) ?? null } },
			}),
			db,
		})
	})

	afterAll(async () => {
		clock?.reset()
		await booted.stop()
	})

	const ingest = (path: string) =>
		ingestDirect(
			booted.payload,
			{ type: 'pageview', path, hostname: 'h', durationMs: 400 },
			{ 'x-vercel-ip-country': 'US' }
		)

	/** The `/p` page's pageviews over the last 30 days, unless `args` says otherwise. */
	const read = (
		args: {
			data?: Record<string, unknown>
			collectionSlug?: string
			metrics?: MetricKey[]
			adapterId?: string
		} = {}
	) =>
		readForField({
			req: readerRequest(booted.payload, { locale: undefined }),
			collectionSlug: 'pages',
			data: { slug: '/p' },
			metrics: ['pageviews'],
			timeframe: 'last30days',
			now: clock.now(),
			...args,
		})

	it('reads per-document totals through the engine', async () => {
		await ingest('/p')
		await ingest('/p')
		const result = await read({ metrics: ['pageviews', 'visitors', 'avgDuration'] })
		expect(result.status).toBe('ok')
		expect(result.metrics.pageviews).toBe(2)
		expect(result.metrics.visitors).toBe(1)
		expect(result.metrics.avgDuration).toBe(400)
	})

	it('returns no-path for an unsaved document', async () => {
		const result = await read({ data: {} })
		expect(result.status).toBe('no-path')
	})

	it('returns not-bound for a collection with no binding', async () => {
		const result = await read({ collectionSlug: 'unbound' })
		expect(result.status).toBe('not-bound')
	})

	it('returns unavailable when no requested metric is supported', async () => {
		const result = await read({ metrics: ['revenue'] })
		expect(result.status).toBe('unavailable')
		expect(result.supportedMetrics).toEqual([])
		expect(result.droppedMetrics).toEqual(['revenue'])
	})

	it('drops unsupported metrics, reads the rest, and warns once with the dropped names', async () => {
		const warn = vi.spyOn(booted.payload.logger, 'warn')
		const result = await read({ metrics: ['pageviews', 'revenue', 'impressions'] })
		expect(result.status).toBe('ok')
		expect(result.supportedMetrics).toEqual(['pageviews'])
		expect(result.droppedMetrics).toEqual(['revenue', 'impressions'])
		expect(result.metrics.pageviews).toBe(2)
		expect(warn).toHaveBeenCalledTimes(1)
		expect(warn).toHaveBeenCalledWith(expect.stringMatching(/native.*revenue, impressions/s))
		warn.mockRestore()
	})

	it('does not warn when every requested metric is supported', async () => {
		const warn = vi.spyOn(booted.payload.logger, 'warn')
		const result = await read()
		expect(result.status).toBe('ok')
		expect(result.droppedMetrics).toEqual([])
		expect(warn).not.toHaveBeenCalled()
		warn.mockRestore()
	})

	it('returns unavailable for an unknown adapter id', async () => {
		const result = await read({ adapterId: 'does-not-exist' })
		expect(result.status).toBe('unavailable')
	})
})
