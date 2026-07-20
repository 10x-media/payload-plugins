import { describe, expect, it } from 'vitest'
import { salvageColor } from './salvage'

describe('salvageColor', () => {
	it('returns valid input trimmed and otherwise unchanged', () => {
		expect(salvageColor('  #fff  ')).toBe('#fff')
		expect(salvageColor('rgb(14 165 233)')).toBe('rgb(14 165 233)')
		expect(salvageColor('Red')).toBe('Red')
		expect(salvageColor('transparent')).toBe('transparent')
	})

	it('recovers the first hex from a double paste', () => {
		expect(salvageColor('#0f172a#0f172a')).toBe('#0f172a')
	})

	it('recovers a hex behind a doubled hash', () => {
		expect(salvageColor('##0f172a')).toBe('#0f172a')
	})

	it('recovers the first named color word', () => {
		expect(salvageColor('  red blue')).toBe('red')
	})

	it('recovers a color function from surrounding css', () => {
		expect(salvageColor('color: rgb(14 165 233);')).toBe('rgb(14 165 233)')
	})

	it('promotes a bare 6-digit hex', () => {
		expect(salvageColor('0f172a')).toBe('#0f172a')
	})

	it('promotes a bare 3-digit hex', () => {
		expect(salvageColor('f00')).toBe('#f00')
	})

	it('returns null for non-colors', () => {
		expect(salvageColor('not a color')).toBeNull()
	})

	it('returns null for empty input', () => {
		expect(salvageColor('')).toBeNull()
		expect(salvageColor('   ')).toBeNull()
	})

	it('returns null for an invalid hex token', () => {
		expect(salvageColor('#xyz')).toBeNull()
	})

	it('picks the first candidate by position', () => {
		expect(salvageColor('#0f172a extra #ff0000')).toBe('#0f172a')
	})

	it('recovers an oklch function with trailing junk', () => {
		expect(salvageColor('oklch(0.62 0.25 29) trailing')).toBe('oklch(0.62 0.25 29)')
	})

	it('does not treat a named color embedded in a longer word as a candidate', () => {
		expect(salvageColor('redish')).toBeNull()
		expect(salvageColor('nored')).toBeNull()
	})

	it('does not match a color function inside a longer identifier', () => {
		expect(salvageColor('argb(1 2 3)')).toBeNull()
	})

	it('skips an invalid function candidate for a later valid one', () => {
		expect(salvageColor('rgb(999%) hsl(200 50% 50%)')).toBe('hsl(200 50% 50%)')
	})
})
