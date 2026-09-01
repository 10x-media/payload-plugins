import { describe, expect, it } from 'vitest'
import { compose, decompose, formatMeasurement, unitLabel } from './format'

describe('decompose/compose', () => {
	it('decomposes cm to feet and inches with carry', () => {
		expect(decompose(180.34, 'cm', 'ft-in')).toEqual({ major: 5, minor: 11 })
		// 182.87 cm is 5 ft 11.996 in; a 0-digit minor must carry to 6 ft 0 in
		expect(decompose(182.87, 'cm', 'ft-in')).toEqual({ major: 6, minor: 0 })
	})
	it('decomposes kg to stones and pounds', () => {
		expect(decompose(81.646627, 'kg', 'st-lb')).toEqual({ major: 12, minor: 12 })
	})
	it('round-trips through compose', () => {
		const back = compose({ major: 5, minor: 11 }, 'ft-in', 'cm')
		expect(back).toBeCloseTo(180.34, 6)
	})
	it('handles zero and sub-major values', () => {
		expect(decompose(0, 'cm', 'ft-in')).toEqual({ major: 0, minor: 0 })
		expect(decompose(20, 'cm', 'ft-in')).toEqual({ major: 0, minor: 8 })
	})
	it('applies the sign to both compound parts and round-trips', () => {
		expect(decompose(-200, 'cm', 'ft-in')).toEqual({ major: -6, minor: -7 })
		expect(compose({ major: -6, minor: -7 }, 'ft-in', 'cm')).toBeCloseTo(-200.66, 2)
	})
	it('never emits negative zero', () => {
		const parts = decompose(-20, 'cm', 'ft-in')
		expect(parts).toEqual({ major: 0, minor: -8 })
		expect(Object.is(parts.major, -0)).toBe(false)
	})
})

describe('formatMeasurement', () => {
	it('formats scalar units per locale', () => {
		expect(
			formatMeasurement(81.646627, { displayUnit: 'kg', locale: 'en-US', storageUnit: 'kg' })
		).toBe('81.6 kg')
		expect(
			formatMeasurement(81.646627, { displayUnit: 'lb', locale: 'en-US', storageUnit: 'kg' })
		).toBe('180 lb')
	})
	it('uses locale number formatting', () => {
		expect(
			formatMeasurement(81.646627, { displayUnit: 'kg', locale: 'de-DE', storageUnit: 'kg' })
		).toBe('81,6 kg')
	})
	it('formats compound units as joined parts', () => {
		const out = formatMeasurement(180.34, {
			displayUnit: 'ft-in',
			locale: 'en-US',
			storageUnit: 'cm',
		})
		expect(out).toContain('5')
		expect(out).toContain('11')
		expect(out).toMatch(/ft/)
		expect(out).toMatch(/in/)
	})
	it('respects precision overrides', () => {
		expect(
			formatMeasurement(81.646627, {
				displayUnit: 'lb',
				locale: 'en-US',
				precision: { lb: 1 },
				storageUnit: 'kg',
			})
		).toBe('180 lb')
	})
})

describe('unitLabel', () => {
	it('derives scalar labels from Intl', () => {
		expect(unitLabel('kg', 'en-US', 'long')).toMatch(/kilogram/i)
		expect(unitLabel('kg', 'de-DE', 'long')).toMatch(/kilogramm/i)
	})
	it('joins compound long labels', () => {
		expect(unitLabel('ft-in', 'en-US', 'long')).toMatch(/feet.*inches/i)
	})
	it('short labels are the static symbols', () => {
		expect(unitLabel('kg', 'en-US', 'short')).toBe('kg')
		expect(unitLabel('ft-in', 'en-US', 'short')).toBe('ft in')
	})
})
