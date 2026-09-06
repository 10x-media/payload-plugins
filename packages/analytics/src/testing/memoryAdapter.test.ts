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

	it('declares page as its only eq filter dimension', () => {
		const caps = memoryAdapter().capabilities
		expect(caps.filters).toEqual(new Set(['page']))
		expect(caps.filterOperators).toEqual(new Set(['eq']))
	})

	it('applies an eq filter on page against stored events before aggregation', async () => {
		const a = memoryAdapter()
		a.record({ path: '/pricing', timestamp: new Date('2026-01-10') })
		a.record({ path: '/about', timestamp: new Date('2026-01-11') })

		const result = await a.query(
			{
				metrics: ['pageviews'],
				dateRange: { start: new Date('2026-01-01'), end: new Date('2026-01-31') },
				filters: [{ dimension: 'page', operator: 'eq', value: '/about' }],
			},
			{}
		)
		expect(result.totals?.pageviews).toBe(1)
	})

	it('failNext makes the next query() call reject, then resets to normal behavior', async () => {
		const a = memoryAdapter()
		a.record({ path: '/pricing', timestamp: new Date('2026-01-10') })
		a.failNext()

		await expect(
			a.query(
				{
					metrics: ['pageviews'],
					dateRange: { start: new Date('2026-01-01'), end: new Date('2026-01-31') },
				},
				{}
			)
		).rejects.toThrow('memory: injected failure')

		const result = await a.query(
			{
				metrics: ['pageviews'],
				dateRange: { start: new Date('2026-01-01'), end: new Date('2026-01-31') },
			},
			{}
		)
		expect(result.totals?.pageviews).toBe(1)
	})

	it('failNext accepts a custom error', async () => {
		const a = memoryAdapter()
		const custom = new Error('boom')
		a.failNext(custom)

		await expect(
			a.query(
				{
					metrics: ['pageviews'],
					dateRange: { start: new Date('2026-01-01'), end: new Date('2026-01-31') },
				},
				{}
			)
		).rejects.toThrow('boom')
	})

	it('drops a filter for a dimension it cannot serve instead of throwing', async () => {
		const a = memoryAdapter()
		a.record({ path: '/pricing', timestamp: new Date('2026-01-10') })

		const result = await a.query(
			{
				metrics: ['pageviews'],
				dateRange: { start: new Date('2026-01-01'), end: new Date('2026-01-31') },
				filters: [{ dimension: 'country', operator: 'eq', value: 'DE' }],
			},
			{}
		)
		expect(result.totals?.pageviews).toBe(1)
	})
})
