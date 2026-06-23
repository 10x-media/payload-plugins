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
	it('returns empty paths for no data', () => {
		expect(monotoneAreaPath([], { width: 100, height: 40 })).toEqual({ line: '', area: '' })
	})
})
