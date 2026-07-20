import { describe, expect, it } from 'vitest'
import { clampMaskDots, DEFAULT_MASK_DOTS } from './maskDots'

describe('clampMaskDots', () => {
	it('defaults to 8 when unset', () => {
		expect(clampMaskDots()).toBe(DEFAULT_MASK_DOTS)
		expect(clampMaskDots(undefined)).toBe(8)
	})

	it('passes through in-range integers', () => {
		expect(clampMaskDots(1)).toBe(1)
		expect(clampMaskDots(8)).toBe(8)
		expect(clampMaskDots(64)).toBe(64)
	})

	it('clamps below the minimum up to 1', () => {
		expect(clampMaskDots(0)).toBe(1)
		expect(clampMaskDots(-5)).toBe(1)
	})

	it('clamps above the maximum down to 64', () => {
		expect(clampMaskDots(65)).toBe(64)
		expect(clampMaskDots(1000)).toBe(64)
		expect(clampMaskDots(Number.POSITIVE_INFINITY)).toBe(64)
	})

	it('truncates fractional counts toward zero before clamping', () => {
		expect(clampMaskDots(3.9)).toBe(3)
		expect(clampMaskDots(1.2)).toBe(1)
		expect(clampMaskDots(0.4)).toBe(1)
	})

	it('falls back to the default for NaN', () => {
		expect(clampMaskDots(Number.NaN)).toBe(DEFAULT_MASK_DOTS)
	})
})
