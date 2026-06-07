import { describe, expect, it } from 'vitest'
import { en } from './en'
import { translations } from './index'
import { keys } from './keys'

describe('form-builder translations', () => {
	it('exposes the fieldTitle key', () => {
		expect(keys.fieldTitle).toBe('formBuilder:fieldTitle')
	})

	it('has an en string for every key', () => {
		for (const key of Object.values(keys)) {
			expect(typeof en[key]).toBe('string')
		}
	})

	it('nests strings under the formBuilder namespace', () => {
		expect(translations.en.formBuilder).toBeDefined()
	})
})
