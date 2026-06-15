import { describe, expect, it } from 'vitest'
import { bucketKey } from './applyDistinctDeltas'

describe('bucketKey', () => {
	it('serializes a rollup key deterministically', () => {
		const key = {
			granularity: 'day' as const,
			period: new Date('2026-01-10T00:00:00Z'),
			path: '/p',
			dimension: 'country',
			dimvalue: 'US',
		}
		expect(bucketKey(key)).toBe('day|2026-01-10T00:00:00.000Z|/p|country|US')
	})

	it('distinguishes the path-level bucket from a dimension bucket', () => {
		const base = {
			granularity: 'day' as const,
			period: new Date('2026-01-10T00:00:00Z'),
			path: '/p',
		}
		expect(bucketKey({ ...base, dimension: '', dimvalue: '' })).not.toBe(
			bucketKey({ ...base, dimension: 'country', dimvalue: 'US' })
		)
	})
})
