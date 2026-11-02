import { describe, expect, it } from 'vitest'
import { clampBubble, DEFAULT_BUBBLE, MAX_RADIUS, MIN_RADIUS } from './bubbleLayout'

describe('the camera bubble default', () => {
	it('sits inside the frame it is measured against', () => {
		expect(clampBubble(DEFAULT_BUBBLE, 16 / 9)).toEqual(DEFAULT_BUBBLE)
	})

	it('is in the bottom-right, where it started life hard-coded', () => {
		expect(DEFAULT_BUBBLE.x).toBeGreaterThan(0.5)
		expect(DEFAULT_BUBBLE.y).toBeGreaterThan(0.5)
	})
})

describe('clamping the bubble to its frame', () => {
	// The radius is a fraction of the SHORT edge, so on a landscape frame it
	// eats proportionally more of the height than the width, which is why the
	// horizontal and vertical limits are not the same number.
	it('keeps the whole circle inside a landscape frame', () => {
		const clamped = clampBubble({ x: 1.2, y: 1.2, radius: 0.1 }, 16 / 9)
		expect(clamped.x).toBeLessThanOrEqual(1)
		expect(clamped.y).toBeLessThanOrEqual(1)
		// Its right edge, in width-fractions, must not pass the frame's own edge.
		expect(clamped.x + clamped.radius / (16 / 9)).toBeLessThanOrEqual(1.0001)
		expect(clamped.y + clamped.radius).toBeLessThanOrEqual(1.0001)
	})

	it('keeps it inside a portrait frame too, where the short edge is the width', () => {
		const clamped = clampBubble({ x: -0.5, y: -0.5, radius: 0.1 }, 9 / 16)
		expect(clamped.x - clamped.radius).toBeGreaterThanOrEqual(-0.0001)
		expect(clamped.y - clamped.radius * (9 / 16)).toBeGreaterThanOrEqual(-0.0001)
	})

	it('refuses a radius smaller than one worth drawing', () => {
		expect(clampBubble({ x: 0.5, y: 0.5, radius: 0.001 }, 16 / 9).radius).toBe(MIN_RADIUS)
	})

	it('refuses a radius that would swallow the frame', () => {
		expect(clampBubble({ x: 0.5, y: 0.5, radius: 0.9 }, 16 / 9).radius).toBe(MAX_RADIUS)
	})

	it('survives nonsense rather than propagating it', () => {
		const clamped = clampBubble(
			{ x: Number.NaN, y: Number.POSITIVE_INFINITY, radius: Number.NaN },
			16 / 9
		)
		expect(Number.isFinite(clamped.x)).toBe(true)
		expect(Number.isFinite(clamped.y)).toBe(true)
		expect(Number.isFinite(clamped.radius)).toBe(true)
	})

	it('treats a nonsense aspect ratio as square rather than dividing by zero', () => {
		expect(Number.isFinite(clampBubble(DEFAULT_BUBBLE, 0).x)).toBe(true)
	})
})
