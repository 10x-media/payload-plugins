import { describe, expect, it } from 'vitest'
import type { ResolvedColorPreset } from './options'
import { derivePresetChip } from './presetChip'

const presets: ResolvedColorPreset[] = [
	{ key: 'brand', label: 'Brand blue', value: '#0ea5e9' },
	{ key: '#f8fafc', label: '#f8fafc', value: '#f8fafc' },
]

describe('derivePresetChip', () => {
	it('maps a known ref to the preset label and value', () => {
		expect(
			derivePresetChip({ editing: false, linked: true, presets, value: 'preset:brand' })
		).toEqual({ key: 'brand', label: 'Brand blue', missing: false, value: '#0ea5e9' })
	})

	it('keeps the stored ref key intact for value-keyed shorthand presets', () => {
		expect(
			derivePresetChip({ editing: false, linked: true, presets, value: 'preset:#f8fafc' })
		).toEqual({ key: '#f8fafc', label: '#f8fafc', missing: false, value: '#f8fafc' })
	})

	it('chips a dangling ref with the key as label and missing flagged', () => {
		expect(
			derivePresetChip({ editing: false, linked: true, presets, value: 'preset:gone' })
		).toEqual({ key: 'gone', label: 'gone', missing: true, value: null })
	})

	it('returns null while editing so typing exits chip mode', () => {
		expect(
			derivePresetChip({ editing: true, linked: true, presets, value: 'preset:brand' })
		).toBeNull()
	})

	it('returns null for non-linked fields, plain colors, empty refs, and non-strings', () => {
		expect(
			derivePresetChip({ editing: false, linked: false, presets, value: 'preset:brand' })
		).toBeNull()
		expect(derivePresetChip({ editing: false, linked: true, presets, value: '#0ea5e9' })).toBeNull()
		expect(derivePresetChip({ editing: false, linked: true, presets, value: 'preset:' })).toBeNull()
		expect(derivePresetChip({ editing: false, linked: true, presets, value: null })).toBeNull()
	})
})
