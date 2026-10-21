import { describe, expect, it } from 'vitest'
import { colorValueIssue } from './valueIssue'

const presets = [{ key: 'brand', label: 'Brand', value: '#0055ff' }]

describe('colorValueIssue', () => {
	it('passes empty and parseable values', () => {
		expect(colorValueIssue('', { linked: false, presets: [] })).toBeNull()
		expect(colorValueIssue(null, { linked: false, presets: [] })).toBeNull()
		expect(colorValueIssue('#ff0000', { linked: false, presets: [] })).toBeNull()
		expect(colorValueIssue('tomato', { linked: false, presets: [] })).toBeNull()
	})

	it('flags unparseable input', () => {
		expect(colorValueIssue('not a color', { linked: false, presets: [] })).toBe('invalidColor')
	})

	it('treats a reference as plain text when the field is not linked', () => {
		expect(colorValueIssue('preset:brand', { linked: false, presets })).toBe('invalidColor')
	})

	it('checks references against the presets when linked', () => {
		expect(colorValueIssue('preset:brand', { linked: true, presets })).toBeNull()
		expect(colorValueIssue('preset:brand/40', { linked: true, presets })).toBeNull()
		expect(colorValueIssue('preset:gone/40', { linked: true, presets })).toBe('missingPreset')
		expect(colorValueIssue('preset:', { linked: true, presets })).toBe('missingPreset')
	})

	it('keeps a bare stale reference lenient, since reads degrade it to the fallback', () => {
		expect(colorValueIssue('preset:gone', { linked: true, presets })).toBeNull()
	})

	it('rejects a numeric suffix outside the alpha grammar', () => {
		expect(colorValueIssue('preset:brand/140', { linked: true, presets })).toBe('invalidColor')
	})

	it('accepts any well-formed reference while no presets are known', () => {
		expect(colorValueIssue('preset:anything', { linked: true, presets: [] })).toBeNull()
	})
})
