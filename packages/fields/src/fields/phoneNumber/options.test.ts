import { describe, expect, it } from 'vitest'
import { resolvePhoneOptions } from './options'

describe('resolvePhoneOptions', () => {
	it('applies documented defaults with no field or global input', () => {
		expect(resolvePhoneOptions({}, undefined)).toMatchObject({
			cellFormat: 'international',
			flags: 'svg',
			metadata: 'max',
			storage: 'object',
			validation: 'valid',
		})
	})

	it('lets a global override a default', () => {
		expect(resolvePhoneOptions({}, { flags: 'emoji' }).flags).toBe('emoji')
	})

	it('lets a field override a global', () => {
		expect(resolvePhoneOptions({ flags: 'none' }, { flags: 'emoji' }).flags).toBe('none')
	})

	it('keeps metadata global-only, ignoring any field-level attempt', () => {
		expect(resolvePhoneOptions({}, { metadata: 'min' }).metadata).toBe('min')
	})

	it('treats an explicit undefined on a field as absent, not as a reset', () => {
		expect(resolvePhoneOptions({ flags: undefined }, { flags: 'emoji' }).flags).toBe('emoji')
	})

	it('defaults isClearable to true with no field or global input', () => {
		expect(resolvePhoneOptions({}, undefined).isClearable).toBe(true)
	})

	it('lets a field turn isClearable off', () => {
		expect(resolvePhoneOptions({ isClearable: false }, undefined).isClearable).toBe(false)
	})

	it('treats an explicit undefined isClearable as absent, not as a reset to false', () => {
		expect(resolvePhoneOptions({ isClearable: undefined }, undefined).isClearable).toBe(true)
	})
})
