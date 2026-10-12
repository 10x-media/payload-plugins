import { describe, expect, it } from 'vitest'
import type { AnalyticsResult } from '../core/contract'
import { memoryCacheStore } from '../testing/memoryCacheStore'
import { isCachedResult, isCacheStore, isReadRecipe, type ReadRecipe } from './cacheStore'

const result: AnalyticsResult = {
	rows: [],
	totals: { pageviews: 1 },
	meta: { provider: 'memory', fetchedAt: '2026-01-31T00:00:00.000Z' },
}

const recipe = (timeframe: ReadRecipe['timeframe']): ReadRecipe => ({
	adapterRef: 'native',
	scope: null,
	timeframe,
	window: 'live',
	query: { metrics: ['pageviews'] },
})

describe('cache store guards', () => {
	it('takes an object with all five methods as a store, and nothing less', () => {
		expect(isCacheStore(memoryCacheStore())).toBe(true)
		const { recentRecipes: _gone, ...partial } = memoryCacheStore()
		expect(isCacheStore(partial)).toBe(false)
		expect(isCacheStore(null)).toBe(false)
	})

	it('reads a stored value of another shape as no result', () => {
		expect(isCachedResult(result)).toBe(true)
		for (const value of [null, 'x', { rows: [] }, { rows: {}, meta: result.meta }]) {
			expect(isCachedResult(value), JSON.stringify(value)).toBe(false)
		}
	})

	it('reads a recipe only when every part of it is there', () => {
		expect(isReadRecipe(recipe('last7days'))).toBe(true)
		expect(isReadRecipe({ ...recipe('last7days'), scope: 1 })).toBe(false)
		expect(isReadRecipe({ ...recipe('last7days'), query: {} })).toBe(false)
		expect(isReadRecipe({ ...recipe('last7days'), timeframe: 'last8days' })).toBe(false)
		expect(isReadRecipe({ ...recipe('last7days'), window: 'tomorrow' })).toBe(false)
		expect(isReadRecipe({ ...recipe('last7days'), window: undefined })).toBe(false)
	})
})

describe('memoryCacheStore', () => {
	it('answers an entry until its staleUntil, then nothing', async () => {
		let at = 0
		const store = memoryCacheStore({ now: () => at })
		await store.set('k', result, { ttlSeconds: 60, staleSeconds: 60 })
		expect(await store.get('k')).toMatchObject({
			fetchedAt: 0,
			expiresAt: 60_000,
			staleUntil: 120_000,
		})
		at = 119_999
		expect(await store.get('k')).not.toBeNull()
		at = 120_000
		expect(await store.get('k')).toBeNull()
	})

	it('sweeps at most a batch of expired entries, newest recipes first and once each', async () => {
		let at = 0
		const store = memoryCacheStore({ now: () => at })
		for (const key of ['a', 'b', 'c']) {
			await store.set(key, result, { ttlSeconds: 1, staleSeconds: 1 })
		}
		at = 10_000
		await store.set('live', result, { ttlSeconds: 1, staleSeconds: 1, recipe: recipe('today') })
		await store.set('again', result, { ttlSeconds: 1, staleSeconds: 1, recipe: recipe('today') })
		expect(await store.sweep(new Date(at), 2)).toBe(2)
		expect(await store.sweep(new Date(at), 2)).toBe(1)
		expect(store.entries.size).toBe(2)
		expect(await store.recentRecipes(new Date(0), 10)).toEqual([recipe('today')])
	})
})
