import { describe, expect, it, vi } from 'vitest'
import type { AnalyticsAdapter, AnalyticsQuery } from '../core/contract'
import { memoryAdapter } from '../testing/memoryAdapter'
import { memoryCacheStore } from '../testing/memoryCacheStore'
import type { CacheStore } from './cacheStore'
import { createEngine } from './engine'

const window = {
	start: new Date('2026-06-01T00:00:00.000Z'),
	end: new Date('2026-06-30T23:59:59.999Z'),
}
const query: AnalyticsQuery = { metrics: ['pageviews'], dateRange: window }

/** A source answering 7 pageviews, counting every time it is asked. */
const counting = () => {
	const query = vi.fn(async () => ({
		rows: [],
		totals: { pageviews: 7 },
		meta: { provider: 'counting', fetchedAt: '2026-06-30T00:00:00.000Z' },
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

/** An engine whose cache clock the test moves; the source's TTL is 60 s, stale for a day after. */
const engineAt = (store?: CacheStore) => {
	const clock = { at: Date.parse('2026-06-30T12:00:00.000Z') }
	const now = () => clock.at
	const engine = createEngine({
		store: store ?? memoryCacheStore({ now }),
		ttl: { aggregate: 60, realtime: 5 },
		timeoutMs: 5_000,
		now,
	})
	return { engine, clock }
}

describe('engine.peek', () => {
	it('answers nothing for a query nobody has read, and never asks the source', async () => {
		const { adapter, query: asked } = counting()
		const { engine } = engineAt()
		expect(await engine.peek(adapter, query)).toBeUndefined()
		expect(asked).not.toHaveBeenCalled()
	})

	it('answers what a read kept, fresh, without asking the source again', async () => {
		const { adapter, query: asked } = counting()
		const { engine } = engineAt()
		await engine.read(adapter, query)
		const kept = await engine.peek(adapter, query)
		expect(kept?.totals).toEqual({ pageviews: 7 })
		expect(kept?.meta.stale).toBeUndefined()
		expect(asked).toHaveBeenCalledTimes(1)
	})

	it('answers an expired entry flagged stale, and starts no refresh the way a read would', async () => {
		const { adapter, query: asked } = counting()
		const { engine, clock } = engineAt()
		await engine.read(adapter, query)
		// Past the 60 s TTL and the 15 s memory window, inside the stale day.
		clock.at += 120_000
		const kept = await engine.peek(adapter, query)
		expect(kept?.meta.stale).toBe(true)
		expect(kept?.totals).toEqual({ pageviews: 7 })
		await engine.idle()
		expect(asked).toHaveBeenCalledTimes(1)
	})

	it('answers nothing once the entry is past its stale window', async () => {
		const { adapter } = counting()
		const { engine, clock } = engineAt()
		await engine.read(adapter, query)
		clock.at += 2 * 86_400_000
		expect(await engine.peek(adapter, query)).toBeUndefined()
	})

	it('gives up on a store that does not answer within the budget', async () => {
		const { adapter, query: asked } = counting()
		const hanging: CacheStore = {
			...memoryCacheStore(),
			get: () => new Promise(() => {}),
		}
		const { engine } = engineAt(hanging)
		const startedAt = Date.now()
		expect(await engine.peek(adapter, query, { budgetMs: 30 })).toBeUndefined()
		expect(Date.now() - startedAt).toBeLessThan(1_000)
		expect(asked).not.toHaveBeenCalled()
	})

	it('takes a store that fails for a miss', async () => {
		const { adapter } = counting()
		const failing: CacheStore = {
			...memoryCacheStore(),
			get: () => Promise.reject(new Error('store down')),
		}
		const { engine } = engineAt(failing)
		expect(await engine.peek(adapter, query)).toBeUndefined()
	})
})
