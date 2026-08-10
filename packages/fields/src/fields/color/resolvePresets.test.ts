import { describe, expect, it } from 'vitest'
import type { ColorPreset } from '../../types'
import { normalizePresets } from './resolvePresets'

/** Malformed shapes a hand-written resolver can produce, which the types forbid. */
const malformed = (presets: unknown[]): ColorPreset[] => presets as ColorPreset[]

describe('normalizePresets', () => {
	it('keeps string presets using the value as key and value', () => {
		expect(normalizePresets(['#ffffff'])).toEqual([{ key: '#ffffff', value: '#ffffff' }])
	})

	it('passes a complete scheme value through', () => {
		const value = { dark: '#000000', light: '#ffffff' }
		expect(normalizePresets([{ key: 'brand', value }])).toEqual([
			{ key: 'brand', label: undefined, value },
		])
	})

	it('fills a half-filled scheme from the present member', () => {
		expect(normalizePresets(malformed([{ key: 'brand', value: { light: '#ffffff' } }]))).toEqual([
			{ key: 'brand', label: undefined, value: { dark: '#ffffff', light: '#ffffff' } },
		])
		expect(normalizePresets(malformed([{ key: 'brand', value: { dark: '#000000' } }]))).toEqual([
			{ key: 'brand', label: undefined, value: { dark: '#000000', light: '#000000' } },
		])
	})

	it('drops a preset carrying no usable value', () => {
		expect(normalizePresets(malformed([{ key: 'brand', value: {} }]))).toEqual([])
		expect(normalizePresets([{ key: 'brand', value: '' }])).toEqual([])
		expect(normalizePresets([{ key: 'brand', value: { dark: '', light: '' } }])).toEqual([])
		expect(normalizePresets(malformed([{ key: 'brand', value: null }]))).toEqual([])
		expect(normalizePresets([''])).toEqual([])
	})

	it('preserves labels', () => {
		expect(normalizePresets([{ key: 'brand', label: 'Brand', value: '#ffffff' }])).toEqual([
			{ key: 'brand', label: 'Brand', value: '#ffffff' },
		])
	})
})
