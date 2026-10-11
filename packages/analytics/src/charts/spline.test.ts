import { describe, expect, it } from 'vitest'
import { computeTangents, monotoneAreaPath, monotoneAreaSegments, readingRuns } from './spline'

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

describe('readingRuns', () => {
	it('splits a series at every gap', () => {
		expect(readingRuns([1, 2, null, 4, null, null, 7, 8])).toEqual([
			{ start: 0, end: 1 },
			{ start: 3, end: 3 },
			{ start: 6, end: 7 },
		])
		expect(readingRuns([null, null])).toEqual([])
	})
})

describe('monotoneAreaSegments', () => {
	const box = { width: 300, height: 40, padding: 0 }

	it('draws a series without gaps exactly as monotoneAreaPath does', () => {
		expect(monotoneAreaSegments([0, 10, 5, 20], box)).toEqual(monotoneAreaPath([0, 10, 5, 20], box))
	})

	// A day with no reading is a break in the line, never a dive to the axis.
	it('stops the line at a gap and leaves a lone reading to its dot', () => {
		const { line, area } = monotoneAreaSegments([0, 10, null, 10], box)
		const moves = line.match(/M[\d.]+,[\d.]+/g) ?? []
		// The first run is drawn from x=0; the lone last reading gets a dot, not a stroke.
		expect(moves).toEqual(['M0,40'])
		expect(line).toContain('100,0')
		expect(line).not.toContain('200,')
		expect(area.endsWith('Z')).toBe(true)
	})

	it('places a later run on the shared x axis and the shared y scale', () => {
		const { line } = monotoneAreaSegments([null, null, 0, 10], box)
		expect(line.startsWith('M200,40')).toBe(true)
		expect(line.endsWith('300,0')).toBe(true)
	})

	it('draws nothing for a series of gaps', () => {
		expect(monotoneAreaSegments([null, null], box)).toEqual({ line: '', area: '' })
	})
})
