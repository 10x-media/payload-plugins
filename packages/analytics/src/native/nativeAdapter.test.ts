import { describe, expect, it } from 'vitest'
import { native } from './nativeAdapter'

describe('native adapter', () => {
	it('advertises pageviews but not visitors (deferred)', () => {
		const caps = native().capabilities
		expect(caps.metrics.has('pageviews')).toBe(true)
		expect(caps.metrics.has('visitors')).toBe(false)
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
})
