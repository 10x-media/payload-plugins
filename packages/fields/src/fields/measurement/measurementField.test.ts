import type { NumberField } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { FIELDS_REGISTRY_KEY } from '../../plugin/registry'
import type { MeasurementCustomConfig } from './engine/registry'
import { measurementField } from './measurementField'
import { MEASUREMENT_CUSTOM_KEY, type MeasurementClientOptions } from './options'
import { presets } from './presets'

const clientOptions = (field: NumberField): MeasurementClientOptions | undefined => {
	const component = field.admin?.components?.Field
	if (!component || typeof component !== 'object' || !('clientProps' in component)) return undefined
	return (component.clientProps as { measurementOptions: MeasurementClientOptions })
		.measurementOptions
}

/** A hook only ever needs `req.payload.config` to read the plugin registry. */
const reqWithRegistry = (custom?: Record<string, unknown>) =>
	({ payload: { config: { custom } } }) as never

const nauticalMile: MeasurementCustomConfig = {
	units: { nmi: { dimension: 'length', factor: 1852, intlUnit: null, shortLabel: 'nmi' } },
}

describe('measurementField factory', () => {
	it('builds a number field from a spread preset', () => {
		const field = measurementField({ ...presets.bodyWeight })
		expect(field.type).toBe('number')
		expect(field.name).toBe('weight')
		expect(field.admin?.components?.Field).toMatchObject({
			path: '@10x-media/fields/rsc#MeasurementFieldServer',
		})
		expect(field.admin?.components?.Cell).toMatchObject({
			path: '@10x-media/fields/rsc#MeasurementCellServer',
		})
		expect(typeof field.validate).toBe('function')
	})
	it('validate rejects NaN and defers everything else to the native validator', async () => {
		const field = measurementField({ ...presets.bodyWeight })
		const options = { req: { t: (key: string) => key } } as never
		expect(await field.validate?.(Number.NaN as never, options)).toBe('validation:enterNumber')
		expect(await field.validate?.(80 as never, options)).toBe(true)
	})
	it('threads the preset into measurementOptions clientProps', () => {
		const field = measurementField({ ...presets.personHeight })
		expect(clientOptions(field)).toEqual({
			dimension: 'length',
			localeDefaults: { metric: 'cm', us: 'ft-in', uk: 'ft-in' },
			preferenceKey: 'personHeight',
			storageUnit: 'cm',
			units: ['cm', 'm', 'in', 'ft-in'],
		})
	})
	it('builds a free-form field with no preset at all', () => {
		const field = measurementField({
			preferenceKey: 'cutout',
			storageUnit: 'mm',
			units: ['in', 'ft-in'],
		})
		expect(field.name).toBe('cutout')
		expect(clientOptions(field)).toEqual({
			dimension: 'length',
			preferenceKey: 'cutout',
			storageUnit: 'mm',
			units: ['in', 'ft-in'],
		})
	})
	it('defaults preferenceKey to the dimension and units to every unit of it', () => {
		const field = measurementField({ storageUnit: 'kg' })
		expect(field.name).toBe('mass')
		expect(clientOptions(field)).toMatchObject({
			dimension: 'mass',
			preferenceKey: 'mass',
			units: ['g', 'kg', 'oz', 'lb', 'st', 'st-lb'],
		})
	})
	it('rounds numeric writes to the default storage precision via beforeValidate', () => {
		const field = measurementField({ ...presets.bodyWeight })
		const hook = field.hooks?.beforeValidate?.[0]
		const req = reqWithRegistry()
		// biome-ignore lint/correctness/noPrecisionLoss: testing rounding behavior with floating point edge case
		expect(hook?.({ req, value: 81.64662660000001 } as never)).toBe(81.646627)
		expect(hook?.({ req, value: 'junk' } as never)).toBe('junk')
		expect(hook?.({ req, value: null } as never)).toBe(null)
	})
	it('rounds writes to a field-declared storage granularity', () => {
		const field = measurementField({ ...presets.bodyWeight, precision: { storage: 0 } })
		const hook = field.hooks?.beforeValidate?.[0]
		expect(hook?.({ req: reqWithRegistry(), value: 249.6 } as never)).toBe(250)
	})
	it('rounds writes to the plugin registry storage default when the field declares none', () => {
		const field = measurementField({ ...presets.bodyWeight })
		const hook = field.hooks?.beforeValidate?.[0]
		const req = reqWithRegistry({
			[FIELDS_REGISTRY_KEY]: { measurement: { precision: { storage: 0 } } },
		})
		expect(hook?.({ req, value: 249.6 } as never)).toBe(250)
	})
	it('degrades to the field-only layer and logs when the registry precision is malformed', () => {
		// A field knob other than storage, so the merge before validation still
		// carries the registry's bad storage value through to resolvePrecision.
		const field = measurementField({ ...presets.bodyWeight, precision: { entry: 'free' } })
		const hook = field.hooks?.beforeValidate?.[0]
		const error = vi.fn()
		const req = {
			payload: {
				config: {
					custom: {
						[FIELDS_REGISTRY_KEY]: { measurement: { precision: { storage: 15 } } },
					},
				},
				logger: { error },
			},
		} as never
		// Falls back to the field-only layer, which declares no storage of its own,
		// so rounding lands on the engine default (6 digits).
		expect(hook?.({ req, value: 249.6666666666 } as never)).toBe(249.666667)
		expect(error).toHaveBeenCalledTimes(1)
	})
	it('passes min/max/required/localized/index through', () => {
		const field = measurementField({ ...presets.bodyWeight, max: 250, min: 30, required: true })
		expect(field.min).toBe(30)
		expect(field.max).toBe(250)
		expect(field.required).toBe(true)
	})
	it('applies function overrides', () => {
		const field = measurementField({
			...presets.distance,
			overrides: ({ field: f }) => ({ ...f, admin: { ...f.admin, width: '50%' } }),
		})
		expect(field.admin?.width).toBe('50%')
	})
	it('throws on a compound storage unit', () => {
		expect(() => measurementField({ storageUnit: 'ft-in' as never })).toThrow(/storageUnit/)
	})
	it('throws on an unknown storage unit', () => {
		expect(() => measurementField({ storageUnit: 'furlong' as never })).toThrow(/storageUnit/)
	})
	it('throws when units leaves the storage unit dimension', () => {
		expect(() =>
			// @ts-expect-error cm is a length unit, so the mass narrowing rejects it
			measurementField({ ...presets.bodyWeight, units: ['kg', 'cm'] })
		).toThrow(/dimension/i)
	})
	it('throws when fallbackUnit is not offered', () => {
		expect(() =>
			measurementField({ ...presets.personHeight, fallbackUnit: 'm', units: ['cm', 'ft-in'] })
		).toThrow(/fallbackUnit/)
	})
	it('threads fallbackUnit into clientProps when it is offered', () => {
		const field = measurementField({ ...presets.bodyWeight, fallbackUnit: 'lb' })
		expect(clientOptions(field)?.fallbackUnit).toBe('lb')
	})
	it('throws on a non-integer or out-of-range precision.display override', () => {
		for (const digits of [1.5, -1, 101]) {
			expect(() =>
				measurementField({ ...presets.bodyWeight, precision: { display: { kg: digits } } })
			).toThrow(/precision/)
		}
	})
	it('throws when a precision.display key is not a unit of the dimension', () => {
		expect(() =>
			// @ts-expect-error cm is a length unit, so the mass narrowing rejects it
			measurementField({ ...presets.bodyWeight, precision: { display: { cm: 1 } } })
		).toThrow(/precision/)
	})
	it('accepts an in-range precision.display override', () => {
		expect(() =>
			measurementField({ ...presets.bodyWeight, precision: { display: { kg: 3 } } })
		).not.toThrow()
	})
	it('accepts a bare precision mode string', () => {
		expect(() => measurementField({ ...presets.bodyWeight, precision: 'exact' })).not.toThrow()
	})
	it('throws on an unknown precision mode string', () => {
		expect(() => measurementField({ ...presets.bodyWeight, precision: 'blurry' as never })).toThrow(
			/precision/
		)
	})
	it('accepts storage 0 as a valid granularity', () => {
		expect(() =>
			measurementField({ ...presets.bodyWeight, precision: { storage: 0 } })
		).not.toThrow()
	})
	it('throws on a non-integer or out-of-range precision.storage', () => {
		for (const storage of [1.5, -1, 13]) {
			expect(() => measurementField({ ...presets.bodyWeight, precision: { storage } })).toThrow(
				/precision\.storage/
			)
		}
	})
	it('threads the field-declared precision layer unresolved into clientProps', () => {
		const field = measurementField({ ...presets.bodyWeight, precision: { storage: 0 } })
		expect(clientOptions(field)?.precision).toEqual({ storage: 0 })
	})
	it('threads a bare precision mode string into clientProps unchanged', () => {
		const field = measurementField({ ...presets.bodyWeight, precision: 'exact' })
		expect(clientOptions(field)?.precision).toBe('exact')
	})
	it('throws on a preference key that is empty or not a single path segment', () => {
		for (const preferenceKey of ['', '  ', 'body weight', 'body/weight']) {
			expect(() => measurementField({ ...presets.bodyWeight, preferenceKey })).toThrow(
				/preferenceKey/
			)
		}
	})
	it('accepts a custom unit as storage, offered unit, and client prop', () => {
		const field = measurementField({
			custom: nauticalMile,
			preferenceKey: 'nautical',
			storageUnit: 'nmi',
			units: ['nmi', 'km'],
		})
		expect(field.name).toBe('nautical')
		expect(clientOptions(field)).toEqual({
			custom: nauticalMile,
			dimension: 'length',
			preferenceKey: 'nautical',
			storageUnit: 'nmi',
			units: ['nmi', 'km'],
		})
	})
	it('surfaces custom config errors with the field name', () => {
		expect(() =>
			measurementField({
				custom: {
					units: { kg: { dimension: 'mass', factor: 2, intlUnit: null, shortLabel: 'x' } },
				},
				name: 'odd',
				storageUnit: 'kg',
			})
		).toThrow(/measurementField\(odd\).*collides/)
	})
	it('stamps the resolved config onto field.custom for discovery by tooling', () => {
		const field = measurementField({ ...presets.bodyWeight })
		expect(field.custom?.[MEASUREMENT_CUSTOM_KEY]).toEqual(clientOptions(field))
	})
	it('overrides can extend custom while the stamp survives via spread', () => {
		const field = measurementField({
			...presets.bodyWeight,
			overrides: ({ field: f }) => ({
				...f,
				custom: { ...f.custom, myTooling: { note: 'extra' } },
			}),
		})
		expect(field.custom?.[MEASUREMENT_CUSTOM_KEY]).toEqual(clientOptions(field))
		expect(field.custom?.myTooling).toEqual({ note: 'extra' })
	})
})
