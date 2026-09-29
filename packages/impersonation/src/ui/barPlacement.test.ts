import { describe, expect, it } from 'vitest'

import { anchorsFor, nearestEdge } from './barPlacement'

const layout = anchorsFor({
	header: 40,
	size: { height: 36, width: 160 },
	viewport: { height: 800, width: 1200 },
})

describe('chip snap anchors', () => {
	it('keeps every anchor inside the viewport', () => {
		for (const point of Object.values(layout)) {
			expect(point.x).toBeGreaterThanOrEqual(0)
			expect(point.x + 160).toBeLessThanOrEqual(1200)
			expect(point.y).toBeGreaterThanOrEqual(40)
			expect(point.y + 36).toBeLessThanOrEqual(800)
		}
	})

	it('snaps a drop near the left side to the left edge', () => {
		expect(nearestEdge({ x: 30, y: 400 }, layout)).toBe('left')
	})

	it('snaps a drop near the right side to the right edge', () => {
		expect(nearestEdge({ x: 1000, y: 400 }, layout)).toBe('right')
	})

	it('snaps a drop in the bottom-right corner to that corner', () => {
		expect(nearestEdge({ x: 1000, y: 740 }, layout)).toBe('bottom-right')
	})

	it('keeps the bottom-right anchor in the viewport corner', () => {
		expect(layout['bottom-right'].x).toBeGreaterThan(layout.bottom.x)
		expect(layout['bottom-right'].y).toBe(layout.bottom.y)
	})
})
