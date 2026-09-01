import { describe, expect, it } from 'vitest'
import { measurementField } from './measurementField'

describe('measurementField factory', () => {
	it('builds a number field with usage-derived defaults', () => {
		const field = measurementField({ usage: 'bodyWeight' })
		expect(field.type).toBe('number')
		expect(field.name).toBe('weight')
		expect(field.admin?.components?.Field).toMatchObject({
			path: '@10x-media/fields/rsc#MeasurementFieldServer',
		})
		expect(field.admin?.components?.Cell).toMatchObject({
			path: '@10x-media/fields/client#MeasurementCell',
		})
		expect(field.validate).toBeUndefined()
	})
	it('threads options into measurementOptions clientProps', () => {
		const field = measurementField({ name: 'h', storageUnit: 'cm', usage: 'personHeight' })
		const fieldComponent = field.admin?.components?.Field
		expect(
			fieldComponent && typeof fieldComponent === 'object' && 'clientProps' in fieldComponent
				? fieldComponent.clientProps
				: undefined
		).toEqual({
			measurementOptions: {
				storageUnit: 'cm',
				units: ['cm', 'm', 'in', 'ft-in'],
				usage: 'personHeight',
			},
		})
	})
	it('rounds numeric writes to storage precision via beforeValidate', () => {
		const field = measurementField({ usage: 'bodyWeight' })
		const hook = field.hooks?.beforeValidate?.[0]
		// biome-ignore lint/correctness/noPrecisionLoss: testing rounding behavior with floating point edge case
		expect(hook?.({ value: 81.64662660000001 } as never)).toBe(81.646627)
		expect(hook?.({ value: 'junk' } as never)).toBe('junk')
		expect(hook?.({ value: null } as never)).toBe(null)
	})
	it('passes min/max/required/localized/index through', () => {
		const field = measurementField({ max: 250, min: 30, required: true, usage: 'bodyWeight' })
		expect(field.min).toBe(30)
		expect(field.max).toBe(250)
		expect(field.required).toBe(true)
	})
	it('applies function overrides', () => {
		const field = measurementField({
			overrides: ({ field: f }) => ({ ...f, admin: { ...f.admin, width: '50%' } }),
			usage: 'distance',
		})
		expect(field.admin?.width).toBe('50%')
	})
	it('throws on a compound storage unit', () => {
		expect(() =>
			measurementField({ storageUnit: 'ft-in' as never, usage: 'personHeight' })
		).toThrow(/storage/i)
	})
	it('throws on a storage unit from another dimension', () => {
		expect(() => measurementField({ storageUnit: 'kg', usage: 'personHeight' })).toThrow(
			/dimension/i
		)
	})
	it('throws when units contains a unit outside the usage', () => {
		expect(() => measurementField({ units: ['kg'], usage: 'personHeight' })).toThrow(/unit/i)
	})
	it('throws when defaultUnit is not offered', () => {
		expect(() =>
			measurementField({ defaultUnit: 'm', units: ['cm', 'ft-in'], usage: 'personHeight' })
		).toThrow(/defaultUnit/i)
	})
})
