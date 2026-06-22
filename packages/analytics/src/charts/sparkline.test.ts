import { describe, expect, it } from 'vitest'
import { buildSparkline } from './sparkline'

describe('buildSparkline', () => {
	it('maps an ascending series across the full box', () => {
		const { line, area } = buildSparkline([0, 10], { width: 100, height: 40, padding: 0 })
		expect(line).toBe('M0,40 L100,0')
		expect(area).toBe('M0,40 L0,40 L100,0 L100,40 Z')
	})

	it('draws a flat series along the vertical middle', () => {
		const { line } = buildSparkline([5, 5, 5], { width: 100, height: 40 })
		expect(line).toBe('M0,20 L50,20 L100,20')
	})

	it('renders a single point as a flat line across the width', () => {
		const { line } = buildSparkline([9], { width: 100, height: 40 })
		expect(line).toBe('M0,20 L100,20')
	})

	it('returns empty paths for an empty series', () => {
		expect(buildSparkline([], { width: 100, height: 40 })).toEqual({ line: '', area: '' })
	})
})
