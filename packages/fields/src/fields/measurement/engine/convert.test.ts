import { describe, expect, it } from 'vitest'
import { convert, roundTo } from './convert'

describe('convert', () => {
	it('converts mass exactly', () => {
		expect(convert(180, 'lb', 'kg')).toBeCloseTo(81.6466266, 6)
		expect(roundTo(convert(81.646627, 'kg', 'lb'), 0)).toBe(180)
	})
	it('converts length', () => {
		expect(convert(180.34, 'cm', 'in')).toBeCloseTo(71, 9)
		expect(convert(1, 'mi', 'km')).toBeCloseTo(1.609344, 9)
	})
	it('converts affine temperature both ways', () => {
		expect(convert(0, 'c', 'f')).toBeCloseTo(32, 9)
		expect(convert(98.6, 'f', 'c')).toBeCloseTo(37, 9)
		expect(convert(-40, 'f', 'c')).toBeCloseTo(-40, 9)
	})
	it('converts speed', () => {
		expect(convert(100, 'km/h', 'mph')).toBeCloseTo(62.1371, 3)
	})
	it('is identity for same unit', () => {
		expect(convert(12.34, 'kg', 'kg')).toBe(12.34)
	})
	it('throws on cross-dimension conversion', () => {
		expect(() => convert(1, 'kg', 'cm')).toThrow(/dimension/)
	})
	it('roundTo kills float noise', () => {
		expect(roundTo(1.005, 2)).toBe(1.01)
		expect(roundTo(179.99999999999997, 0)).toBe(180)
	})
})
