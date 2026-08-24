import { describe, expect, it } from 'vitest'
import { buildCacheKey } from './cacheKey'
import type { AnalyticsQuery } from './contract'

const base: AnalyticsQuery = {
	path: '/pricing',
	metrics: ['pageviews', 'visitors'],
	dateRange: { start: new Date('2026-01-01'), end: new Date('2026-01-31') },
}

describe('buildCacheKey', () => {
	it('is stable regardless of metric order', () => {
		const a = buildCacheKey('ga4', base)
		const b = buildCacheKey('ga4', { ...base, metrics: ['visitors', 'pageviews'] })
		expect(a).toBe(b)
	})
	it('differs by provider', () => {
		expect(buildCacheKey('ga4', base)).not.toBe(buildCacheKey('plausible', base))
	})
	it('differs by path', () => {
		expect(buildCacheKey('ga4', base)).not.toBe(buildCacheKey('ga4', { ...base, path: '/about' }))
	})
	it('uses "site" when path is omitted', () => {
		const { path: _path, ...siteWide } = base
		expect(buildCacheKey('ga4', siteWide)).toContain('site')
	})
	it('differs by sort order', () => {
		const asc = buildCacheKey('ga4', { ...base, order: { metric: 'pageviews', direction: 'asc' } })
		const desc = buildCacheKey('ga4', {
			...base,
			order: { metric: 'pageviews', direction: 'desc' },
		})
		expect(asc).not.toBe(desc)
	})
	it('is stable for two reads on the same UTC day with different sub-day ends', () => {
		const a = buildCacheKey('native', {
			metrics: ['pageviews'],
			dateRange: {
				start: new Date('2026-06-01T00:00:00.000Z'),
				end: new Date('2026-06-23T08:00:00.000Z'),
			},
		})
		const b = buildCacheKey('native', {
			metrics: ['pageviews'],
			dateRange: {
				start: new Date('2026-06-01T00:00:00.000Z'),
				end: new Date('2026-06-23T19:45:12.913Z'),
			},
		})
		expect(a).toBe(b)
	})
	it('differs once the end crosses into the next UTC day', () => {
		const a = buildCacheKey('native', {
			metrics: ['pageviews'],
			dateRange: {
				start: new Date('2026-06-01T00:00:00.000Z'),
				end: new Date('2026-06-23T23:00:00.000Z'),
			},
		})
		const b = buildCacheKey('native', {
			metrics: ['pageviews'],
			dateRange: {
				start: new Date('2026-06-01T00:00:00.000Z'),
				end: new Date('2026-06-24T01:00:00.000Z'),
			},
		})
		expect(a).not.toBe(b)
	})
	it('keeps the unscoped key format unchanged', () => {
		expect(buildCacheKey('ga4', base)).toBe(
			'analytics|ga4|_|/pricing|pageviews,visitors||2026-01-01T00:00:00.000Z_2026-02-01T00:00:00.000Z|_||_|_'
		)
	})
	it('partitions the key by scope', () => {
		const unscoped = buildCacheKey('ga4', base)
		const a = buildCacheKey('ga4', { ...base, scope: 'tenant-a' })
		const b = buildCacheKey('ga4', { ...base, scope: 'tenant-b' })
		expect(a).not.toBe(unscoped)
		expect(a).not.toBe(b)
		expect(a).toBe(buildCacheKey('ga4', { ...base, scope: 'tenant-a' }))
	})
	it('encodes scope values so a delimiter cannot forge another key segment', () => {
		expect(buildCacheKey('ga4', { ...base, scope: 'a|b' }).endsWith('|a%7Cb')).toBe(true)
	})
	it('keeps the key unchanged for an explicit UTC timezone', () => {
		expect(buildCacheKey('ga4', { ...base, timezone: 'UTC' })).toBe(buildCacheKey('ga4', base))
	})
	it('partitions the key by a non-UTC timezone', () => {
		const utc = buildCacheKey('ga4', base)
		const berlin = buildCacheKey('ga4', { ...base, timezone: 'Europe/Berlin' })
		expect(berlin).not.toBe(utc)
		expect(berlin).toContain('Europe/Berlin')
	})
	it('orders the timezone segment before the scope segment', () => {
		const key = buildCacheKey('ga4', { ...base, timezone: 'Europe/Berlin', scope: 'tenant-a' })
		expect(key.endsWith('|Europe/Berlin|tenant-a')).toBe(true)
	})
	it('two instance ids of one provider type produce distinct keys', () => {
		const q = base
		expect(buildCacheKey('posthog:a', q)).not.toBe(buildCacheKey('posthog:b', q))
	})
})
