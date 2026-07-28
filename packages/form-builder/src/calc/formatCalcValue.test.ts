import { describe, expect, it } from 'vitest'
import { formatCalcValue } from './formatCalcValue'

describe('formatCalcValue', () => {
	it('renders the bare number without config', () => {
		expect(formatCalcValue(7)).toBe('7')
		expect(formatCalcValue(7.5, {})).toBe('7.5')
	})

	it('applies fixed decimals, including zero', () => {
		expect(formatCalcValue(7.005, { decimals: 2 })).toBe('7.00')
		expect(formatCalcValue(7.5, { decimals: 0 })).toBe('8')
		expect(formatCalcValue(7, { decimals: 2 })).toBe('7.00')
	})

	it('wraps prefix and suffix exactly as authored, with no injected spaces', () => {
		expect(formatCalcValue(7, { decimals: 2, prefix: 'EUR ' })).toBe('EUR 7.00')
		expect(formatCalcValue(7, { suffix: ' kg' })).toBe('7 kg')
		expect(formatCalcValue(7, { prefix: '~', suffix: '%' })).toBe('~7%')
	})

	it('ignores malformed config values', () => {
		expect(formatCalcValue(7, { decimals: 9 })).toBe('7')
		expect(formatCalcValue(7, { decimals: -1 })).toBe('7')
		expect(formatCalcValue(7, { decimals: 1.5 })).toBe('7')
		expect(formatCalcValue(7, { decimals: '2', prefix: 3, suffix: null })).toBe('7')
	})
})
