import { describe, expect, it } from 'vitest'

import { anchorsFor, nearestEdge } from './barPlacement'

const layout = anchorsFor({
	header: 40,
	inset: { end: 0, start: 275 },
	size: { height: 36, width: 160 },
	viewport: { height: 800, width: 1200 },
})

describe('bar snap anchors', () => {
	it('keeps every edge to the right of the nav', () => {
		for (const point of Object.values(layout)) {
			expect(point.x).toBeGreaterThanOrEqual(275)
		}
	})

	it('snaps a drop beside the nav to the left edge of the content', () => {
		expect(nearestEdge({ x: 280, y: 400 }, layout)).toBe('left')
	})

	it('snaps a drop near the right side to the right edge', () => {
		expect(nearestEdge({ x: 1000, y: 400 }, layout)).toBe('right')
	})

	it('snaps a drop in the bottom-right corner to that corner', () => {
		expect(nearestEdge({ x: 1000, y: 740 }, layout)).toBe('bottom-right')
	})

	it('keeps the bottom-right anchor in the content corner', () => {
		expect(layout['bottom-right'].x).toBeGreaterThan(layout.bottom.x)
		expect(layout['bottom-right'].y).toBe(layout.bottom.y)
	})
})
