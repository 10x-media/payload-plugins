import { describe, expect, it } from 'vitest'
import { isColorSchemeValue, lightDark } from './scheme'

describe('isColorSchemeValue', () => {
	it('accepts an object with string light and dark members', () => {
		expect(isColorSchemeValue({ dark: '#000000', light: '#ffffff' })).toBe(true)
	})

	it('rejects strings, null, arrays, and partial members', () => {
		expect(isColorSchemeValue('#ffffff')).toBe(false)
		expect(isColorSchemeValue(null)).toBe(false)
		expect(isColorSchemeValue(undefined)).toBe(false)
		expect(isColorSchemeValue(['#ffffff', '#000000'])).toBe(false)
		expect(isColorSchemeValue({ light: '#ffffff' })).toBe(false)
		expect(isColorSchemeValue({ dark: 1, light: '#ffffff' })).toBe(false)
	})
})

describe('lightDark', () => {
	it('wraps a scheme value in the CSS light-dark function', () => {
		expect(lightDark({ dark: '#000000', light: '#ffffff' })).toBe('light-dark(#ffffff, #000000)')
	})

	it('passes a flat string through unchanged', () => {
		expect(lightDark('oklch(0.72 0.19 145)')).toBe('oklch(0.72 0.19 145)')
	})
})
