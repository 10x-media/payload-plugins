import { describe, expect, it } from 'vitest'
import { computeDelta, previousWindow } from './comparison'

describe('previousWindow', () => {
	it('returns the same count of whole days immediately preceding the range', () => {
		// A preset-style range: 7 day starts touched (Jun 8..Jun 14 plus the partial Jun 14 end).
		const range = {
			start: new Date('2026-06-08T00:00:00.000Z'),
			end: new Date('2026-06-14T15:30:00.000Z'),
		}
		expect(previousWindow(range)).toEqual({
			start: new Date('2026-06-01T00:00:00.000Z'),
			end: new Date('2026-06-07T23:59:59.999Z'),
		})
	})

	it('ends strictly before the current window so day-stamped rollups never overlap', () => {
		const range = {
			start: new Date('2026-06-08T00:00:00.000Z'),
			end: new Date('2026-06-14T15:30:00.000Z'),
		}
		const prev = previousWindow(range)
		if (!prev) {
			throw new Error('expected a previous window')
		}
		expect(prev.end.getTime()).toBeLessThan(range.start.getTime())
	})

	it('aligns the previous window to reporting-timezone day starts', () => {
		// Berlin day starts are 22:00Z in summer; a 7-Berlin-day window steps back 7 local days.
		const range = {
			start: new Date('2026-06-07T22:00:00.000Z'),
			end: new Date('2026-06-14T09:00:00.000Z'),
		}
		expect(previousWindow(range, 'Europe/Berlin')).toEqual({
			start: new Date('2026-05-31T22:00:00.000Z'),
			end: new Date('2026-06-07T21:59:59.999Z'),
		})
	})

	it('returns null for an unbounded range (allTime)', () => {
		expect(
			previousWindow({ start: new Date(0), end: new Date('2026-06-14T00:00:00.000Z') })
		).toBeNull()
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
