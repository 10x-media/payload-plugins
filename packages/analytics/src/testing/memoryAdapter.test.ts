import { describe, expect, it } from 'vitest'
import { memoryAdapter } from './memoryAdapter'

describe('memoryAdapter', () => {
	it('records events and aggregates pageviews per path', async () => {
		const a = memoryAdapter()
		a.record({ path: '/pricing', timestamp: new Date('2026-01-10') })
		a.record({ path: '/pricing', timestamp: new Date('2026-01-11') })
		a.record({ path: '/about', timestamp: new Date('2026-01-11') })

		const result = await a.query(
			{
				path: '/pricing',
				metrics: ['pageviews'],
				dateRange: { start: new Date('2026-01-01'), end: new Date('2026-01-31') },
			},
			{}
		)
		expect(result.totals?.pageviews).toBe(2)
		expect(result.meta.provider).toBe('memory')
	})

	it('isConfigured is always true', () => {
		expect(memoryAdapter().isConfigured()).toBe(true)
	})
})
