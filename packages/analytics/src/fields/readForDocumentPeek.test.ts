import type { PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import type { AnalyticsAdapter, AnalyticsQuery } from '../core/contract'
import { createRegistry } from '../core/registry'
import { setRuntime } from '../plugin/runtime'
import { createEngine } from '../surfacing/engine'
import { memoryAdapter } from '../testing/memoryAdapter'
import { memoryCacheStore } from '../testing/memoryCacheStore'
import { peekForField, readForField } from './readForDocument'

const NOW = new Date('2026-06-03T12:00:00.000Z')

/** A source counting its reads: 9 visitors for the page, and one country row for a breakdown. */
const counting = () => {
	const query = vi.fn(async (q: AnalyticsQuery) => ({
		rows: q.dimensions ? [{ dimensions: { country: 'DE' }, metrics: { visitors: 4 } }] : [],
		totals: { visitors: 9 },
		meta: { provider: 'counting', fetchedAt: NOW.toISOString() },
	}))
	const adapter: AnalyticsAdapter = {
		id: 'counting',
		label: 'Counting',
		capabilities: memoryAdapter().capabilities,
		isConfigured: () => true,
		query,
	}
	return { adapter, query }
}

/** A runtime on a real engine and an in-memory store, whose cache clock the test moves. */
const requestOn = (adapter: AnalyticsAdapter) => {
	const clock = { at: NOW.getTime() }
	const now = () => clock.at
	const payload = { logger: { warn: () => {} } } as unknown as PayloadRequest['payload']
	setRuntime(payload, {
		registry: createRegistry([adapter]),
		configAdapterIds: new Set([adapter.id]),
		bindings: { pages: { pathField: 'slug', scopeField: false } },
		readAccess: () => true,
		engine: createEngine({
			store: memoryCacheStore({ now }),
			ttl: { aggregate: 60, realtime: 5 },
			timeoutMs: 5_000,
			now,
		}),
		ttl: { aggregate: 60, realtime: 5 },
		comparison: true,
	})
	return { req: () => ({ payload }) as PayloadRequest, clock }
}

const args = (req: PayloadRequest, over: Record<string, unknown> = {}) => ({
	req,
	collectionSlug: 'pages',
	data: { slug: '/pricing' },
	metrics: ['visitors' as const],
	timeframe: 'last30days' as const,
	now: NOW,
	compare: true,
	series: true,
	...over,
})

describe('peekForField', () => {
	it('finds nothing for a page nobody has read, without asking the source', async () => {
		const { adapter, query } = counting()
		const { req } = requestOn(adapter)
		const peeked = await peekForField(args(req()))
		expect(peeked.complete).toBe(false)
		expect(peeked.result.status).toBe('busy')
		expect(query).not.toHaveBeenCalled()
	})

	it('answers what an earlier read kept, complete and fresh, without asking again', async () => {
		const { adapter, query } = counting()
		const { req } = requestOn(adapter)
		await readForField(args(req()))
		const asked = query.mock.calls.length
		const peeked = await peekForField(args(req()))
		expect(peeked).toMatchObject({ complete: true, stale: false })
		expect(peeked.result.status).toBe('ok')
		expect(peeked.result.metrics).toEqual({ visitors: 9 })
		expect(peeked.result.previousMetrics).toEqual({ visitors: 9 })
		expect(peeked.result.points?.length).toBeGreaterThan(0)
		expect(query).toHaveBeenCalledTimes(asked)
	})

	it('says when what it found was kept past its freshness', async () => {
		const { adapter, query } = counting()
		const { req, clock } = requestOn(adapter)
		await readForField(args(req()))
		const asked = query.mock.calls.length
		clock.at += 120_000
		const peeked = await peekForField(args(req()))
		expect(peeked).toMatchObject({ complete: true, stale: true })
		expect(peeked.result.status).toBe('ok')
		expect(peeked.result.notices?.stale).toBe(true)
		expect(query).toHaveBeenCalledTimes(asked)
	})

	it('keeps the totals and says it is incomplete when a list was never read', async () => {
		const { adapter } = counting()
		const { req } = requestOn(adapter)
		await readForField(args(req()))
		const peeked = await peekForField(args(req(), { dimensions: ['country'] }))
		expect(peeked.complete).toBe(false)
		expect(peeked.result.status).toBe('ok')
		expect(peeked.result.breakdowns).toBeUndefined()
	})

	it('answers a status decided before any read as final', async () => {
		const { adapter, query } = counting()
		const { req } = requestOn(adapter)
		const peeked = await peekForField(args(req(), { data: {} }))
		expect(peeked).toMatchObject({ complete: true, stale: false })
		expect(peeked.result.status).toBe('no-path')
		expect(query).not.toHaveBeenCalled()
	})
})
