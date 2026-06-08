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
})
