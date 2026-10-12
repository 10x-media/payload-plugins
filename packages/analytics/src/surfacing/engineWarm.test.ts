import { describe, expect, it, vi } from 'vitest'
import { ProviderHttpError } from '../adapters/http/fetchJson'
import type { AnalyticsAdapter, AnalyticsQuery, AnalyticsResult } from '../core/contract'
import { memoryAdapter } from '../testing/memoryAdapter'
import { memoryCacheStore } from '../testing/memoryCacheStore'
import { previousWindow } from '../timeframe/comparison'
import { resolveTimeframe } from '../timeframe/presets'
import { addDaysInTz, startOfDayInTz } from '../timeframe/tz'
import type { ReadRecipe } from './cacheStore'
import { ReadFailedError } from './classifyError'
import { createEngine, type EngineOptions } from './engine'
import { createLanes, type Lanes } from './lanes'
import { AGGREGATE_MEMO_MS } from './memo'

const NOW = Date.parse('2026-10-07T10:00:00.000Z')
const HOUR = 3_600_000

const recorded = () => {
	const adapter = memoryAdapter()
	adapter.record({ path: '/pricing', timestamp: new Date('2026-10-01T12:00:00.000Z') })
	return adapter
}

const setup = (extra: Partial<EngineOptions> = {}) => {
	const clock = { at: NOW }
	const now = () => clock.at
	const adapter = recorded()
	const store = memoryCacheStore({ now })
	const engine = createEngine({
		store,
		ttl: { aggregate: 3_600, realtime: 5 },
		timeoutMs: 15_000,
		now,
		...extra,
	})
	return { adapter, engine, store, clock }
}

const base = { metrics: ['pageviews' as const], path: '/pricing' }

/** `last30days` as a widget reads it: from its first day to the moment of the read. */
const live = (tz = 'UTC', at = NOW): AnalyticsQuery => ({
	...base,
	timezone: tz,
	dateRange: resolveTimeframe('last30days', new Date(at), tz),
})

/** `last30days` as the view asks for it: its whole calendar days, today's included. */
const days = (tz = 'UTC'): AnalyticsQuery => {
	const window = resolveTimeframe('last30days', new Date(NOW), tz)
	return {
		...base,
		timezone: tz,
		dateRange: {
			start: startOfDayInTz(window.start, tz),
			end: new Date(addDaysInTz(window.end, 1, tz).getTime() - 1),
		},
	}
}

const recipeOf = (window: ReadRecipe['window'], tz = 'UTC'): ReadRecipe => ({
	adapterRef: 'memory',
	scope: null,
	timeframe: 'last30days',
	window,
	query: { ...base, timezone: tz },
})

describe('createEngine recipes', () => {
	it('stores the recipe of a read whose window is its timeframe now, and stamps a hit hourly', async () => {
		const { adapter, engine, store, clock } = setup()
		const touch = vi.spyOn(store, 'touch')
		await engine.read(adapter, live(), { timeframe: 'last30days' })
		expect(await store.recentRecipes(new Date(0), 10)).toEqual([recipeOf('live')])
		clock.at = NOW + AGGREGATE_MEMO_MS
		await engine.read(adapter, live(), { timeframe: 'last30days' })
		expect(touch).not.toHaveBeenCalled()
		clock.at = NOW + HOUR
		await engine.read(adapter, live('UTC', NOW + HOUR), { timeframe: 'last30days' })
		expect(touch).toHaveBeenCalledWith(expect.any(String), new Date(NOW + HOUR), recipeOf('live'))
	})

	it('names the window it saw: up to now, the view’s whole days, or the comparison before', async () => {
		const { adapter, engine, store } = setup()
		const tz = 'Europe/Berlin'
		await engine.read(adapter, days(tz), { timeframe: 'last30days' })
		const before = previousWindow(live(tz).dateRange, tz)
		if (!before) {
			throw new Error('last30days has a previous window')
		}
		await engine.read(adapter, { ...live(tz), dateRange: before }, { timeframe: 'last30days' })
		await engine.read(adapter, live(tz), { timeframe: 'last30days' })
		const windows = (await store.recentRecipes(new Date(0), 10)).map((recipe) => recipe.window)
		expect(windows.sort()).toEqual(['days', 'live', 'previous'])
	})

	it('stores none for a window that is not its timeframe’s, or a read naming no timeframe', async () => {
		const { adapter, engine, store } = setup()
		await engine.read(
			adapter,
			{ ...live(), dateRange: { start: new Date('2026-06-01'), end: new Date('2026-06-30') } },
			{ timeframe: 'last30days' }
		)
		await engine.read(adapter, live(), { timeframe: 'last7days' })
		await engine.read(adapter, { ...live(), path: '/other' })
		expect(store.entries.size).toBe(3)
		expect(await store.recentRecipes(new Date(0), 10)).toEqual([])
	})

	it('records the read’s own scope, for the warm task to cut the window in its zone', async () => {
		const { adapter, engine, store } = setup()
		await engine.read(adapter, { ...live(), scope: 'tenant-a' }, { timeframe: 'last30days' })
		expect(await store.recentRecipes(new Date(0), 10)).toEqual([
			{
				...recipeOf('live'),
				scope: 'tenant-a',
				query: { ...base, timezone: 'UTC', scope: 'tenant-a' },
			},
		])
	})

	it('matches a window the source clamps, which a replay clamps the same way', async () => {
		const { engine, store } = setup()
		const adapter = {
			...recorded(),
			capabilities: { ...recorded().capabilities, maxLookbackDays: 7 },
		}
		await engine.read(adapter, live(), { timeframe: 'last30days' })
		expect(await store.recentRecipes(new Date(0), 10)).toEqual([recipeOf('live')])
	})
})

describe('createEngine refresh', () => {
	it('reads the source for an entry that is missing, storing it without a recipe', async () => {
		const { adapter, engine, store } = setup()
		const spy = vi.spyOn(adapter, 'query')
		expect(await engine.refresh(adapter, live(), { freshForMs: HOUR / 2 })).toBe('refreshed')
		expect(spy).toHaveBeenCalledTimes(1)
		const [entry] = [...store.entries.values()]
		expect(entry?.recipe).toBeUndefined()
		expect(entry?.readAt).toBeNull()
	})

	it('leaves an entry fresh past the next run, and reads one expiring before it', async () => {
		const { adapter, engine, clock } = setup()
		await engine.read(adapter, live())
		const spy = vi.spyOn(adapter, 'query')
		clock.at = NOW + 20 * 60_000
		expect(await engine.refresh(adapter, live(), { freshForMs: 30 * 60_000 })).toBe('fresh')
		expect(spy).not.toHaveBeenCalled()
		clock.at = NOW + 40 * 60_000
		expect(await engine.refresh(adapter, live(), { freshForMs: 30 * 60_000 })).toBe('refreshed')
		expect(spy).toHaveBeenCalledTimes(1)
	})

	it('keeps the recipe and the read time a reader left on the entry', async () => {
		const { adapter, engine, store, clock } = setup()
		await engine.read(adapter, live(), { timeframe: 'last30days' })
		clock.at = NOW + 50 * 60_000
		expect(await engine.refresh(adapter, live(), { freshForMs: 30 * 60_000 })).toBe('refreshed')
		const [entry] = [...store.entries.values()]
		expect(entry?.recipe).toEqual(recipeOf('live'))
		expect(entry?.readAt).toBe(NOW)
		expect(entry?.fetchedAt).toBe(NOW + 50 * 60_000)
	})

	it('gives a warmed entry the recipe of the first reader to ask for it', async () => {
		const { adapter, engine, store, clock } = setup()
		await engine.refresh(adapter, live(), { freshForMs: 0 })
		// Past the in-process memo, which answers a read before the store is asked.
		clock.at = NOW + AGGREGATE_MEMO_MS
		await engine.read(adapter, live(), { timeframe: 'last30days' })
		expect(await store.recentRecipes(new Date(0), 10)).toEqual([recipeOf('live')])
	})

	it('asks the source at background priority, and rejects as a read does when it fails', async () => {
		const priorities: string[] = []
		const lanes: Lanes = {
			for: () => ({
				run: (fn, options) => {
					priorities.push(options.priority)
					return fn(options.signal)
				},
				health: () => ({ open: false }),
			}),
		}
		const { adapter, engine } = setup({ lanes })
		await engine.refresh(adapter, live(), { freshForMs: 0 })
		expect(priorities).toEqual(['background'])
		adapter.failNext(new ProviderHttpError(400, 'memory', 'invalid query'), 1)
		await expect(
			engine.refresh(adapter, { ...live(), path: '/x' }, { freshForMs: 0 })
		).rejects.toBeInstanceOf(ReadFailedError)
	})
})

const liveSource = (id: string, count: () => Promise<number>): AnalyticsAdapter => ({
	...memoryAdapter(),
	id,
	realtime: async (): Promise<AnalyticsResult> => ({
		rows: [],
		totals: { visitors: await count() },
		meta: { provider: id, fetchedAt: new Date(NOW).toISOString() },
	}),
})

const realtimeQuery: AnalyticsQuery = {
	metrics: ['visitors'],
	dateRange: { start: new Date(NOW - 30 * 60_000), end: new Date(NOW) },
}

describe('createEngine realtime', () => {
	it('reads a live count through the source’s lane at interactive priority', async () => {
		const priorities: string[] = []
		const lanes: Lanes = {
			for: () => ({
				run: (fn, options) => {
					priorities.push(options.priority)
					return fn(options.signal)
				},
				health: () => ({ open: false }),
			}),
		}
		const { engine } = setup({ lanes })
		const result = await engine.realtime(
			liveSource('vendor', async () => 4),
			realtimeQuery
		)
		expect(result.totals?.visitors).toBe(4)
		expect(priorities).toEqual(['interactive'])
	})

	it('waits for a vendor’s slot, while the native engine’s own lane stays free', async () => {
		const lanes = createLanes({ global: 1, perSource: 1, local: { is: (a) => a.id === 'native' } })
		const { engine } = setup({ lanes })
		let release: () => void = () => undefined
		const held = new Promise<number>((resolve) => {
			release = () => resolve(1)
		})
		const slow = engine.realtime(
			liveSource('slow', () => held),
			realtimeQuery
		)
		let other = false
		const queued = engine
			.realtime(
				liveSource('other', async () => 2),
				realtimeQuery
			)
			.then(() => {
				other = true
			})
		const native = await engine.realtime(
			liveSource('native', async () => 3),
			realtimeQuery
		)
		expect(native.totals?.visitors).toBe(3)
		await new Promise((resolve) => setTimeout(resolve, 5))
		expect(other).toBe(false)
		release()
		await Promise.all([slow, queued])
		expect(other).toBe(true)
	})

	it('counts a failing live count against the source’s breaker, which then refuses at once', async () => {
		const { engine } = setup()
		const count = vi.fn(async (): Promise<number> => {
			throw new ProviderHttpError(401, 'flaky', 'key revoked')
		})
		const source = liveSource('flaky', count)
		await expect(engine.realtime(source, realtimeQuery)).rejects.toBeInstanceOf(ReadFailedError)
		const calls = count.mock.calls.length
		await expect(engine.realtime(source, realtimeQuery)).rejects.toMatchObject({
			failure: { kind: 'source_misconfigured' },
		})
		expect(count.mock.calls.length).toBe(calls)
	})

	it('refuses a source that counts no live visitors', async () => {
		const { engine } = setup()
		await expect(engine.realtime(memoryAdapter(), realtimeQuery)).rejects.toThrow(
			/counts no live visitors/
		)
	})
})
