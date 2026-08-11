import { describe, expect, it } from 'vitest'
import {
	applyReferenceAlpha,
	formatPresetReference,
	parsePresetReference,
	presetReferenceIssue,
	presetReferenceParts,
} from './presetReference'

describe('parsePresetReference', () => {
	it('returns null for non-references and empty keys', () => {
		expect(parsePresetReference('#ff0000')).toBeNull()
		expect(parsePresetReference('tomato')).toBeNull()
		expect(parsePresetReference('preset:')).toBeNull()
		expect(parsePresetReference('preset:/40')).toBeNull()
	})

	it('parses a bare reference at full opacity', () => {
		expect(parsePresetReference('preset:brand')).toEqual({ alpha: 100, key: 'brand' })
	})

	it('parses a valid alpha suffix off the last slash', () => {
		expect(parsePresetReference('preset:brand-blue/40')).toEqual({ alpha: 40, key: 'brand-blue' })
		expect(parsePresetReference('preset:brand/0')).toEqual({ alpha: 0, key: 'brand' })
		expect(parsePresetReference('preset:brand/100')).toEqual({ alpha: 100, key: 'brand' })
	})

	it('gives the alpha reading precedence for numeric keys', () => {
		expect(parsePresetReference('preset:3/40')).toEqual({ alpha: 40, key: '3' })
	})

	it('keeps slash-containing keys intact when the suffix is not an alpha', () => {
		expect(parsePresetReference('preset:acme/surface')).toEqual({ alpha: 100, key: 'acme/surface' })
		expect(parsePresetReference('preset:acme/surface/40')).toEqual({
			alpha: 40,
			key: 'acme/surface',
		})
	})

	it('folds malformed suffixes into the key', () => {
		expect(parsePresetReference('preset:key/101')).toEqual({ alpha: 100, key: 'key/101' })
		expect(parsePresetReference('preset:key/4.5')).toEqual({ alpha: 100, key: 'key/4.5' })
		expect(parsePresetReference('preset:key/040')).toEqual({ alpha: 100, key: 'key/040' })
		expect(parsePresetReference('preset:key/00')).toEqual({ alpha: 100, key: 'key/00' })
		expect(parsePresetReference('preset:key/40%')).toEqual({ alpha: 100, key: 'key/40%' })
	})
})

describe('formatPresetReference', () => {
	it('emits the bare canonical form at alpha 100', () => {
		expect(formatPresetReference('brand', 100)).toBe('preset:brand')
		expect(formatPresetReference('brand')).toBe('preset:brand')
	})

	it('emits the alpha suffix below 100', () => {
		expect(formatPresetReference('brand', 40)).toBe('preset:brand/40')
		expect(formatPresetReference('brand', 0)).toBe('preset:brand/0')
	})

	it('round-trips through the parser', () => {
		for (const key of ['brand', 'acme/surface', '3', 'a.b_c']) {
			for (const alpha of [0, 7, 40, 99, 100]) {
				expect(parsePresetReference(formatPresetReference(key, alpha))).toEqual({ alpha, key })
			}
		}
	})
})

describe('presetReferenceParts', () => {
	it('marks whether the alpha was explicit', () => {
		expect(presetReferenceParts('preset:brand')).toEqual({
			alpha: 100,
			explicit: false,
			key: 'brand',
		})
		expect(presetReferenceParts('preset:brand/100')).toEqual({
			alpha: 100,
			explicit: true,
			key: 'brand',
		})
		expect(presetReferenceParts('preset:brand/40')).toEqual({
			alpha: 40,
			explicit: true,
			key: 'brand',
		})
	})
})

describe('presetReferenceIssue', () => {
	const hasKey = (key: string) => ['brand', 'acme/surface'].includes(key)

	it('flags empty keys as missing', () => {
		expect(presetReferenceIssue('preset:', hasKey)).toBe('missingKey')
		expect(presetReferenceIssue('preset:/40', hasKey)).toBe('missingKey')
	})

	it('passes bare references regardless of key existence', () => {
		expect(presetReferenceIssue('preset:brand', hasKey)).toBeNull()
		expect(presetReferenceIssue('preset:ghost', hasKey)).toBeNull()
	})

	it('flags numeric-like suffixes outside the alpha grammar as invalid', () => {
		expect(presetReferenceIssue('preset:key/101', hasKey)).toBe('invalidAlpha')
		expect(presetReferenceIssue('preset:key/4.5', hasKey)).toBe('invalidAlpha')
		expect(presetReferenceIssue('preset:key/040', hasKey)).toBe('invalidAlpha')
	})

	it('requires the key to exist when a valid alpha suffix is present', () => {
		expect(presetReferenceIssue('preset:brand/40', hasKey)).toBeNull()
		expect(presetReferenceIssue('preset:acme/surface/40', hasKey)).toBeNull()
		expect(presetReferenceIssue('preset:ghost/40', hasKey)).toBe('unknownKey')
	})

	it('skips the key check when no key list is available', () => {
		expect(presetReferenceIssue('preset:ghost/40', null)).toBeNull()
		expect(presetReferenceIssue('preset:key/101', null)).toBe('invalidAlpha')
		expect(presetReferenceIssue('preset:/40', null)).toBe('missingKey')
	})

	it('leaves non-alpha slash keys alone', () => {
		expect(presetReferenceIssue('preset:acme/surface', hasKey)).toBeNull()
		expect(presetReferenceIssue('preset:acme/unknown', hasKey)).toBeNull()
	})
})

describe('applyReferenceAlpha', () => {
	it('scales a flat color and formats in the requested format', () => {
		expect(applyReferenceAlpha('#0ea5e9', 40, 'hex')).toBe('#0ea5e966')
		expect(applyReferenceAlpha('#ff0000', 40, 'rgb')).toBe('rgb(255 0 0 / 0.4)')
	})

	it('multiplies into an existing alpha channel', () => {
		expect(applyReferenceAlpha('rgb(255 0 0 / 0.5)', 40, 'rgb')).toBe('rgb(255 0 0 / 0.2)')
	})

	it('applies to both members of a scheme value', () => {
		expect(applyReferenceAlpha({ dark: '#000000', light: '#ffffff' }, 40, 'hex')).toEqual({
			dark: '#00000066',
			light: '#ffffff66',
		})
	})

	it('leaves unparseable members untouched', () => {
		expect(applyReferenceAlpha('var(--brand)', 40, 'hex')).toBe('var(--brand)')
	})
})
