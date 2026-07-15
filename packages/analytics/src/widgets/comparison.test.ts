import { describe, expect, it } from 'vitest'
import { computeDelta, previousWindow } from './comparison'

describe('previousWindow', () => {
	it('returns the equal-length window immediately preceding the range', () => {
		const range = {
			start: new Date('2026-06-08T00:00:00.000Z'),
			end: new Date('2026-06-15T00:00:00.000Z'),
		}
		expect(previousWindow(range)).toEqual({
			start: new Date('2026-06-01T00:00:00.000Z'),
			end: new Date('2026-06-08T00:00:00.000Z'),
		})
	})
})

describe('computeDelta', () => {
	it('reports an increase with a positive percentage', () => {
		expect(computeDelta(150, 100)).toEqual({ direction: 'up', percent: 50 })
	})

	it('reports a decrease with a negative percentage', () => {
		expect(computeDelta(80, 100)).toEqual({ direction: 'down', percent: -20 })
	})

	it('reports no change when the values match', () => {
		expect(computeDelta(100, 100)).toEqual({ direction: 'none', percent: 0 })
	})

	it('reports null percent when the previous value is zero', () => {
		expect(computeDelta(5, 0)).toEqual({ direction: 'up', percent: null })
	})

	it('returns null when either value is missing', () => {
		expect(computeDelta(undefined, 100)).toBeNull()
		expect(computeDelta(100, undefined)).toBeNull()
	})
})
