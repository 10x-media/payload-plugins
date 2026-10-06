import { describe, expect, it } from 'vitest'
import { computeTangents, monotoneAreaPath } from './spline'

describe('computeTangents', () => {
	it('uses secants at the ends and smoothed slopes inside (monotone series)', () => {
		expect(computeTangents([0, 1, 4, 9])).toEqual([1, 2, 4, 5])
	})
	it('flattens tangents around a zero secant', () => {
		expect(computeTangents([5, 5, 9])).toEqual([0, 0, 4])
	})
})

describe('monotoneAreaPath', () => {
	it('maps a two-point series to a straight cubic and a closed area', () => {
		const { line, area } = monotoneAreaPath([0, 10], { width: 100, height: 40, padding: 0 })
		expect(line).toBe('M0,40 C33.33,26.67 66.67,13.33 100,0')
		expect(area).toBe('M0,40 C33.33,26.67 66.67,13.33 100,0 L100,40 L0,40 Z')
	})
	it('renders a single point as a flat midline', () => {
		expect(monotoneAreaPath([7], { width: 100, height: 40 }).line).toBe('M0,20 L100,20')
	})
	it('honours an explicit domain, so two series share one y-scale', () => {
		const { line } = monotoneAreaPath([0, 10], {
			width: 100,
			height: 40,
			padding: 0,
			domain: { min: 0, max: 20 },
		})
		// 10 of a 0-20 domain lands on the midline instead of the top.
		expect(line.endsWith('100,20')).toBe(true)
	})
	it('returns empty paths for no data', () => {
		expect(monotoneAreaPath([], { width: 100, height: 40 })).toEqual({ line: '', area: '' })
	})
})
