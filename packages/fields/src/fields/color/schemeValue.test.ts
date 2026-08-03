import { describe, expect, it } from 'vitest'
import { flatValue, swatchBackground } from './schemeValue'

describe('flatValue', () => {
	it('returns the light member of a scheme value', () => {
		expect(flatValue({ dark: '#000000', light: '#ffffff' })).toBe('#ffffff')
	})

	it('passes a string through and maps anything unusable to null', () => {
		expect(flatValue('#ffffff')).toBe('#ffffff')
		expect(flatValue(null)).toBeNull()
		expect(flatValue(undefined)).toBeNull()
		expect(flatValue('')).toBeNull()
		expect(flatValue(42)).toBeNull()
	})
})

describe('swatchBackground', () => {
	it('normalizes a flat color', () => {
		expect(swatchBackground('#ffffff')).toBe('rgb(255 255 255)')
	})

	it('renders a scheme value as a diagonal split', () => {
		expect(swatchBackground({ dark: '#000000', light: '#ffffff' })).toBe(
			'linear-gradient(135deg, rgb(255 255 255) 0 50%, rgb(0 0 0) 50% 100%)'
		)
	})

	it('falls back to the raw member when it does not parse', () => {
		expect(swatchBackground('var(--brand)')).toBe('var(--brand)')
		expect(swatchBackground({ dark: 'var(--ink)', light: '#ffffff' })).toBe(
			'linear-gradient(135deg, rgb(255 255 255) 0 50%, var(--ink) 50% 100%)'
		)
	})

	it('returns null for nothing to render', () => {
		expect(swatchBackground(null)).toBeNull()
		expect(swatchBackground(undefined)).toBeNull()
		expect(swatchBackground('')).toBeNull()
		expect(swatchBackground({})).toBeNull()
	})
})
