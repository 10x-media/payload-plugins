import { describe, expect, it } from 'vitest'
import { native } from './nativeAdapter'

describe('native adapter', () => {
	it('advertises visitors, sessions, and the country dimension', () => {
		const caps = native().capabilities
		expect(caps.metrics.has('pageviews')).toBe(true)
		expect(caps.metrics.has('visitors')).toBe(true)
		expect(caps.metrics.has('sessions')).toBe(true)
		expect(caps.dimensions.has('country')).toBe(true)
	})

	it('serves and filters every dimension the tracker can know', () => {
		const caps = native().capabilities
		for (const dimension of [
			'referrer',
			'region',
			'city',
			'browser',
			'os',
			'language',
			'utmSource',
			'utmMedium',
			'utmCampaign',
			'utmContent',
			'utmTerm',
		] as const) {
			expect(caps.dimensions.has(dimension)).toBe(true)
			expect(caps.filters.has(dimension)).toBe(true)
		}
		expect([...caps.filterOperators].sort()).toEqual(['contains', 'eq'])
	})

	it('is configured', () => {
		expect(native().isConfigured()).toBe(true)
	})

	it('throws when queried before init', async () => {
		await expect(
			native().query(
				{ metrics: ['pageviews'], dateRange: { start: new Date(), end: new Date() } },
				{}
			)
		).rejects.toThrow(/before init/i)
	})

	it('still constructs with a (possibly missing) geo database path', () => {
		expect(typeof native({ geoDbPath: '/nonexistent/GeoLite2-City.mmdb' }).query).toBe('function')
	})
})

describe('native capture', () => {
	it('declares no proxy routes and no snippet scripts', () => {
		const capture = native().capture
		expect(capture?.proxy.routes).toEqual([])
		expect(capture?.snippet({ path: '/na' })).toEqual({ scripts: [] })
	})

	it('client is just the native kind, no ingestPath', () => {
		const capture = native({ ingestPath: '/custom/ingest' }).capture
		expect(capture?.client).toEqual({ kind: 'native' })
		expect(JSON.parse(JSON.stringify(capture?.client))).toEqual({ kind: 'native' })
	})

	it('declares where its ingest endpoint listens, default and overridden', () => {
		expect(native().ingest?.path).toBe('/analytics/ingest')
		expect(native({ ingestPath: '/custom/ingest' }).ingest?.path).toBe('/custom/ingest')
	})

	it('accepts server events alongside the endpoint', () => {
		expect(typeof native().ingest?.track).toBe('function')
	})
})
