import { describe, expect, it } from 'vitest'
import { buildCacheKey, buildRealtimeKey, type CacheKeyEpochs, keyedQuery } from './cacheKey'
import type { AnalyticsQuery } from './contract'

const epochs: CacheKeyEpochs = { config: '0', refresh: '0' }

const base: AnalyticsQuery = {
	path: '/pricing',
	metrics: ['pageviews', 'visitors'],
	dateRange: { start: new Date('2026-01-01'), end: new Date('2026-01-31') },
}

const key = (q: AnalyticsQuery, source = 'ga4', e: CacheKeyEpochs = epochs): string =>
	buildCacheKey(source, q, e)

describe('buildCacheKey', () => {
	it('is r: and a 43-character base64url digest, whatever the query holds', () => {
		const long = key({ ...base, path: `/${'a'.repeat(5_000)}`, scope: 'x|y:z' })
		for (const k of [key(base), long]) {
			expect(k).toMatch(/^r:[A-Za-z0-9_-]{43}$/)
		}
	})

	it('is stable regardless of the order of every set and of the query keys', () => {
		const shuffled: AnalyticsQuery = {
			dateRange: base.dateRange,
			metrics: ['visitors', 'pageviews'],
			path: '/pricing',
		}
		expect(key(shuffled)).toBe(key(base))
		const filtered = (order: 'ab' | 'ba'): AnalyticsQuery => {
			const a = { dimension: 'country' as const, operator: 'eq' as const, value: 'DE' }
			const b = { operator: 'contains' as const, value: 'blog', dimension: 'page' as const }
			return {
				...base,
				dimensions: order === 'ab' ? ['page', 'country'] : ['country', 'page'],
				filters: order === 'ab' ? [a, b] : [b, a],
				goalSlugs: order === 'ab' ? ['signup', 'purchase'] : ['purchase', 'signup'],
			}
		}
		expect(key(filtered('ab'))).toBe(key(filtered('ba')))
	})

	it('reads a repeated member of a set once', () => {
		expect(key({ ...base, metrics: ['pageviews', 'visitors', 'pageviews'] })).toBe(key(base))
	})

	it('differs by source, path, order and every epoch', () => {
		const all = [
			key(base),
			key(base, 'plausible'),
			key({ ...base, path: '/about' }),
			key({ ...base, order: { metric: 'pageviews', direction: 'asc' } }),
			key({ ...base, order: { metric: 'pageviews', direction: 'desc' } }),
			key(base, 'ga4', { config: 'c1', refresh: '0' }),
			key(base, 'ga4', { config: '0', refresh: 'c1' }),
			key({ ...base, limit: 10 }),
			key({ ...base, granularity: 'day' }),
		]
		expect(new Set(all).size).toBe(all.length)
	})

	// Each pair shared one key under the delimited format the plugin wrote before.
	it('keys apart queries a delimited format would collide', () => {
		const { path: _path, ...siteWide } = base
		expect(key(siteWide)).not.toBe(key({ ...base, path: 'site' }))
		expect(key(base)).not.toBe(key({ ...base, hostname: '_' }))
		expect(
			key({ ...base, filters: [{ dimension: 'country', operator: 'eq', value: 'DE;pageeqx' }] })
		).not.toBe(
			key({
				...base,
				filters: [
					{ dimension: 'country', operator: 'eq', value: 'DE' },
					{ dimension: 'page', operator: 'eq', value: 'x' },
				],
			})
		)
		expect(key(base, 'e5', { config: '0', refresh: '0' })).not.toBe(
			key(base, 'e0', { config: '0', refresh: '5' })
		)
	})

	it('partitions by scope, timezone, item and goal hint', () => {
		const all = [
			key(base),
			key({ ...base, scope: 'tenant-a' }),
			key({ ...base, scope: 'tenant-b' }),
			key({ ...base, timezone: 'Europe/Berlin' }),
			key({ ...base, scope: 'Europe/Berlin' }),
			key({ ...base, item: 'offers:1' }),
			key({ ...base, item: 'offers:2' }),
			key({ ...base, goalSlugs: ['signup'] }),
			key({ ...base, goalSlugs: ['signup', 'purchase'] }),
			key({ ...base, goalSlugs: 'unresolved' }),
			key({ ...base, goalSlugs: ['unresolved'] }),
		]
		expect(new Set(all).size).toBe(all.length)
	})

	it('keys an explicit UTC and an empty goal hint like their absence, which ask the same', () => {
		expect(key({ ...base, timezone: 'UTC' })).toBe(key(base))
		expect(key({ ...base, goalSlugs: [] })).toBe(key(base))
		expect(key({ ...base, dimensions: [], filters: [] })).toBe(key(base))
	})

	it('shares one entry between two reads of the same UTC day with different ends', () => {
		const read = (end: string) =>
			key({
				metrics: ['pageviews'],
				dateRange: { start: new Date('2026-06-01T00:00:00.000Z'), end: new Date(end) },
			})
		expect(read('2026-06-23T08:00:00.000Z')).toBe(read('2026-06-23T19:45:12.913Z'))
		expect(read('2026-06-23T23:00:00.000Z')).not.toBe(read('2026-06-24T01:00:00.000Z'))
	})

	it('keys a closed window on its exact bounds, in the query timezone', () => {
		const berlin = (end: string) =>
			keyedQuery({
				metrics: ['pageviews'],
				timezone: 'Europe/Berlin',
				dateRange: { start: new Date('2026-05-31T22:00:00.000Z'), end: new Date(end) },
			}).window
		expect(berlin('2026-06-23T21:59:59.999Z')).toBe(
			'2026-05-31T22:00:00.000Z_2026-06-23T21:59:59.999Z'
		)
		// The picker's raw local midnight snaps; the inclusive window it resolves to does not.
		expect(berlin('2026-06-22T22:00:00.000Z')).not.toBe(berlin('2026-06-23T21:59:59.999Z'))
		const utc = keyedQuery({
			metrics: ['pageviews'],
			dateRange: {
				start: new Date('2026-05-31T22:00:00.000Z'),
				end: new Date('2026-06-23T21:59:59.999Z'),
			},
		}).window
		expect(utc).toBe('2026-05-31T00:00:00.000Z_2026-06-24T00:00:00.000Z')
	})
})

describe('buildRealtimeKey', () => {
	const parts = { metric: 'visitors', windowMinutes: 30, series: true }

	it('keys every part and epoch apart, under its own prefix', () => {
		const all = [
			buildRealtimeKey('native', parts, epochs),
			buildRealtimeKey('native', { ...parts, windowMinutes: 5 }, epochs),
			buildRealtimeKey('native', { ...parts, scope: 'a' }, epochs),
			buildRealtimeKey('native', { ...parts, path: '/a' }, epochs),
			buildRealtimeKey('native', { ...parts, series: false }, epochs),
			buildRealtimeKey('native', parts, { config: '0', refresh: '1' }),
			buildRealtimeKey('plausible', parts, epochs),
		]
		expect(new Set(all).size).toBe(all.length)
		expect(all[0]).toMatch(/^rt:[A-Za-z0-9_-]{43}$/)
	})
})
