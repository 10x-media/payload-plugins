import { describe, expect, it } from 'vitest'
import type { FormFieldInstance } from '../submissions/types'
import { buildFieldTypeRegistry, buildValidationRuleRegistry } from './resolveForm'
import { validateFieldValue } from './validateField'

const registry = buildFieldTypeRegistry()
const ruleRegistry = buildValidationRuleRegistry()
const t = (key: string) => key

describe('validateFieldValue', () => {
	it('flags a required field that is empty', async () => {
		const field: FormFieldInstance = { blockType: 'text', name: 'a', required: true }
		const { errors } = await validateFieldValue({
			field,
			value: '',
			registry,
			ruleRegistry,
			answers: { a: '' },
			locale: 'en',
			t,
		})
		expect(errors.length).toBeGreaterThan(0)
	})

	it('passes a satisfied field', async () => {
		const field: FormFieldInstance = { blockType: 'text', name: 'a', required: true }
		const { errors } = await validateFieldValue({
			field,
			value: 'hi',
			registry,
			ruleRegistry,
			answers: { a: 'hi' },
			locale: 'en',
			t,
		})
		expect(errors).toEqual([])
	})

	// The client registry is the same defaultFieldDefinitions the server uses, so the checkbox's
	// intrinsic required check reaches the visitor rather than only failing at submit.
	it('flags a required checkbox the visitor checked and then unchecked', async () => {
		const field: FormFieldInstance = { blockType: 'checkbox', name: 'terms', required: true }
		const { errors } = await validateFieldValue({
			field,
			value: false,
			registry,
			ruleRegistry,
			answers: { terms: false },
			locale: 'en',
			t,
		})
		expect(errors).toEqual(['formBuilder:validation.required'])
	})

	it('passes a required checkbox the visitor checked', async () => {
		const field: FormFieldInstance = { blockType: 'checkbox', name: 'terms', required: true }
		const { errors } = await validateFieldValue({
			field,
			value: true,
			registry,
			ruleRegistry,
			answers: { terms: true },
			locale: 'en',
			t,
		})
		expect(errors).toEqual([])
	})
})
