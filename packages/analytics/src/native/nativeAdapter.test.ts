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
