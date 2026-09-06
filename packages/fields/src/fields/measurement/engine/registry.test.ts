import { describe, expect, it } from 'vitest'
import { convert } from './convert'
import { decompose, formatMeasurement } from './format'
import { createEngine, type MeasurementCustomConfig } from './registry'

describe('createEngine: zero-custom parity', () => {
	const engine = createEngine()

	it('convert matches the static function', () => {
		expect(engine.convert(180, 'lb', 'kg')).toBe(convert(180, 'lb', 'kg'))
	})
	it('formatMeasurement matches the static function', () => {
		expect(
			engine.formatMeasurement(81.646627, { displayUnit: 'lb', locale: 'en-US', storageUnit: 'kg' })
		).toBe(formatMeasurement(81.646627, { displayUnit: 'lb', locale: 'en-US', storageUnit: 'kg' }))
	})
	it('decompose matches the static function', () => {
		expect(engine.decompose(180.34, 'cm', 'ft-in')).toEqual(decompose(180.34, 'cm', 'ft-in'))
	})
})

describe('createEngine: custom units', () => {
	const custom: MeasurementCustomConfig = {
		units: {
			nmi: { dimension: 'length', factor: 1852, intlUnit: null, shortLabel: 'nmi' },
		},
	}
	const engine = createEngine(custom)

	it('converts against built-in units of the same dimension', () => {
		expect(engine.convert(1852, 'm', 'nmi')).toBe(1)
		expect(engine.convert(1, 'nmi', 'm')).toBe(1852)
	})
	it('formats with the plain-decimal + shortLabel fallback', () => {
		expect(
			engine.formatMeasurement(2778, { displayUnit: 'nmi', locale: 'en-US', storageUnit: 'm' })
		).toBe('1.5 nmi')
	})
	it('unitLabel falls back to shortLabel for both styles', () => {
		expect(engine.unitLabel('nmi', 'en-US', 'short')).toBe('nmi')
		expect(engine.unitLabel('nmi', 'en-US', 'long')).toBe('nmi')
	})
	it('defaults precision to 2 when omitted', () => {
		expect(engine.precisionFor('nmi')).toBe(2)
	})
	it('resolves a plain-string shortLabel the same for every locale', () => {
		expect(engine.unitLabel('nmi', 'en-US', 'short')).toBe('nmi')
		expect(engine.unitLabel('nmi', 'de-DE', 'short')).toBe('nmi')
	})
	it('lists the custom unit alongside built-ins for its dimension', () => {
		const units = engine.unitsOfDimension('length')
		expect(units).toContain('nmi')
		expect(units).toContain('cm')
	})
	it('splits and rebuilds a compound display over a custom storage unit', () => {
		const parts = engine.decompose(1, 'nmi', 'ft-in')
		expect(parts).toEqual({ major: 6076, minor: 1 })
		expect(engine.compose(parts, 'ft-in', 'nmi')).toBeCloseTo(1, 4)
	})
	it('formats a compound display over a custom storage unit', () => {
		expect(
			engine.formatMeasurement(1, { displayUnit: 'ft-in', locale: 'en-US', storageUnit: 'nmi' })
		).toBe('6,076 ft 1 in')
	})
})

describe('createEngine: localized custom labels', () => {
	const custom: MeasurementCustomConfig = {
		units: {
			nmi: {
				dimension: 'length',
				factor: 1852,
				intlUnit: null,
				longLabel: { 'de-AT': 'Seemeile (AT)', de: 'Seemeile', en: 'nautical mile' },
				shortLabel: { de: 'sm', en: 'nmi', fr: 'mn' },
			},
		},
	}
	const engine = createEngine(custom)

	it('resolves the exact locale entry', () => {
		expect(engine.unitLabel('nmi', 'fr', 'short')).toBe('mn')
	})
	it('falls back to the language prefix', () => {
		expect(engine.unitLabel('nmi', 'de-AT', 'short')).toBe('sm')
		expect(engine.unitLabel('nmi', 'de-AT', 'long')).toBe('Seemeile (AT)')
	})
	it('falls back to the en entry when neither exact nor prefix match', () => {
		expect(engine.unitLabel('nmi', 'ja-JP', 'short')).toBe('nmi')
	})
	it('falls back to the first value when there is no en entry', () => {
		const noEnglish = createEngine({
			units: {
				nmi: { dimension: 'length', factor: 1852, intlUnit: null, shortLabel: { fr: 'mn' } },
			},
		})
		expect(noEnglish.unitLabel('nmi', 'ja-JP', 'short')).toBe('mn')
	})
})

describe('createEngine: custom dimensions', () => {
	const custom: MeasurementCustomConfig = {
		units: {
			bar: { dimension: 'pressure', factor: 100000, intlUnit: null, shortLabel: 'bar' },
			pa: { dimension: 'pressure', factor: 1, intlUnit: null, shortLabel: 'Pa' },
		},
		dimensions: {
			pressure: { canonicalUnit: 'pa' },
		},
	}
	const engine = createEngine(custom)

	it('converts both ways through the custom canonical', () => {
		expect(engine.convert(100000, 'pa', 'bar')).toBe(1)
		expect(engine.convert(1, 'bar', 'pa')).toBe(100000)
	})
	it('reports the custom dimension for its units', () => {
		expect(engine.dimensionOf('pa')).toBe('pressure')
		expect(engine.dimensionOf('bar')).toBe('pressure')
	})
	it('honors a per-unit precision override', () => {
		const withPrecision: MeasurementCustomConfig = {
			units: {
				bar: {
					dimension: 'pressure',
					factor: 100000,
					intlUnit: null,
					precision: 4,
					shortLabel: 'bar',
				},
				pa: { dimension: 'pressure', factor: 1, intlUnit: null, shortLabel: 'Pa' },
			},
			dimensions: custom.dimensions,
		}
		expect(createEngine(withPrecision).precisionFor('bar')).toBe(4)
	})
})

describe('createEngine: validation', () => {
	it('throws when a custom unit id collides with a built-in', () => {
		expect(() =>
			createEngine({
				units: { kg: { dimension: 'mass', factor: 1, intlUnit: null, shortLabel: 'kg2' } },
			})
		).toThrow(/collides with a built-in unit id/)
	})
	it('throws when a custom unit references an unknown dimension', () => {
		expect(() =>
			createEngine({
				units: {
					furlong: { dimension: 'nope', factor: 201.168, intlUnit: null, shortLabel: 'fur' },
				},
			})
		).toThrow(/unknown dimension/)
	})
	it('throws when a custom dimension collides with a core dimension', () => {
		expect(() => createEngine({ dimensions: { mass: { canonicalUnit: 'kg' } } })).toThrow(
			/collides with a built-in dimension/
		)
	})
	it('throws when a custom dimension canonicalUnit is not one of its own units', () => {
		expect(() =>
			createEngine({
				units: { pa: { dimension: 'pressure', factor: 1, intlUnit: null, shortLabel: 'Pa' } },
				dimensions: { pressure: { canonicalUnit: 'missing' } },
			})
		).toThrow(/must be a custom unit declared for dimension/)
	})
	it('throws when a custom dimension canonicalUnit is not factor 1', () => {
		expect(() =>
			createEngine({
				units: {
					bar: { dimension: 'pressure', factor: 100000, intlUnit: null, shortLabel: 'bar' },
				},
				dimensions: { pressure: { canonicalUnit: 'bar' } },
			})
		).toThrow(/must have factor 1 and no offset/)
	})
	it('throws on an unrecognized top-level custom config key', () => {
		expect(() =>
			createEngine({
				// @ts-expect-error exercising an unknown key at the config boundary
				extra: { anything: true },
			})
		).toThrow(/"extra".*not recognized/)
	})
	it('throws when a custom dimension canonicalUnit declares an offset', () => {
		expect(() =>
			createEngine({
				units: {
					weird: { dimension: 'weird', factor: 1, offset: 5, intlUnit: null, shortLabel: 'w' },
				},
				dimensions: { weird: { canonicalUnit: 'weird' } },
			})
		).toThrow(/must have factor 1 and no offset/)
	})
})
