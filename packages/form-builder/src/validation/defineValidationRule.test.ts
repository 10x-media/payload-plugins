import { describe, expect, it } from 'vitest'
import { defineValidationRule } from './defineValidationRule'

const message = () => 'too short'

describe('defineValidationRule', () => {
	it('returns the definition unchanged', () => {
		const rule = defineValidationRule<{ min: number }, string>({
			type: 'minLength',
			label: 'validation:minLength.label',
			defaultMessage: 'validation:minLength.message',
			params: [{ name: 'min', type: 'number', required: true }],
			validate: ({ value, params, message }) =>
				value == null || value.length >= params.min ? true : message({ min: params.min }),
		})
		expect(rule.type).toBe('minLength')
		expect(rule.params).toHaveLength(1)
	})

	it('threads typed params and value into validate', () => {
		const rule = defineValidationRule<{ min: number }, string>({
			type: 'minLength',
			label: 'L',
			defaultMessage: 'M',
			params: [{ name: 'min', type: 'number', required: true }],
			validate: ({ value, params }) =>
				value != null && value.length >= params.min ? true : 'short',
		})
		const args = {
			value: 'ab',
			params: { min: 3 },
			siblingData: {},
			data: {},
			field: { blockType: 'text', name: 'x' },
			fieldType: 'text',
			operation: 'create' as const,
			event: 'submit' as const,
			locale: 'en',
			message,
		}
		expect(rule.validate(args)).toBe('short')
		expect(rule.validate({ ...args, value: 'abcd' })).toBe(true)
	})
})
