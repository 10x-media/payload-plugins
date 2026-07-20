import { describe, expect, it } from 'vitest'
import { contrastRatio, relativeLuminance } from './contrast'

describe('wcag contrast', () => {
	it('computes relative luminance', () => {
		expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 6)
		expect(relativeLuminance('#000000')).toBe(0)
		expect(relativeLuminance('#ff0000')).toBeCloseTo(0.2126, 4)
	})

	it('computes contrast ratio order-independently', () => {
		expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5)
		expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
		expect(contrastRatio('#ff0000', '#ffffff')).toBeCloseTo(3.998, 2)
		expect(contrastRatio('white', 'white')).toBeCloseTo(1, 6)
	})

	it('throws a TypeError on unparseable input', () => {
		expect(() => contrastRatio('garbage', '#ffffff')).toThrow(TypeError)
		expect(() => relativeLuminance('nope')).toThrow(TypeError)
	})
})
