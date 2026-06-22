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
})
