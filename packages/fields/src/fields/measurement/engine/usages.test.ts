import { describe, expect, it } from 'vitest'
import { dimensionOf, isScalarUnit, UNITS } from './units'
import { resolveUnitForLocale, systemForLocale, USAGES } from './usages'

describe('usage registry', () => {
	it('every usage default and storage unit belongs to its own unit list and dimension', () => {
		for (const [usage, def] of Object.entries(USAGES)) {
			expect(isScalarUnit(def.defaultStorageUnit), usage).toBe(true)
			expect(UNITS[def.defaultStorageUnit].dimension).toBe(def.dimension)
			for (const unit of def.units)
				expect(dimensionOf(unit), `${usage}:${unit}`).toBe(def.dimension)
			for (const unit of Object.values(def.defaults)) expect(def.units).toContain(unit)
		}
	})
})

describe('systemForLocale (vendored CLDR measurementData)', () => {
	it.each([
		['en-US', 'us'],
		['en-LR', 'us'],
		['en-GB', 'uk'],
		['my-MM', 'uk'],
		['de-DE', 'metric'],
		['fr-CA', 'metric'],
		['ja', 'metric'],
	])('%s -> %s', (locale, system) => {
		expect(systemForLocale(locale)).toBe(system)
	})
	it('maximizes bare language subtags', () => {
		expect(systemForLocale('en')).toBe('us')
		expect(systemForLocale('de')).toBe('metric')
	})
	it('falls back to metric on garbage', () => {
		expect(systemForLocale('not-a-locale-!!')).toBe('metric')
	})
})

describe('resolveUnitForLocale', () => {
	it('gives UK body weight in stones and pounds, height in feet and inches, distance in miles', () => {
		expect(resolveUnitForLocale('en-GB', 'bodyWeight')).toBe('st-lb')
		expect(resolveUnitForLocale('en-GB', 'personHeight')).toBe('ft-in')
		expect(resolveUnitForLocale('en-GB', 'distance')).toBe('mi')
	})
	it('gives US pounds and German metric', () => {
		expect(resolveUnitForLocale('en-US', 'bodyWeight')).toBe('lb')
		expect(resolveUnitForLocale('de-DE', 'bodyWeight')).toBe('kg')
	})
})
