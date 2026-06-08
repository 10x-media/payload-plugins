import { describe, expect, it } from 'vitest'
import { defaultFieldDefinitions } from '../fields/builtin'
import { buildRegistry } from '../fields/registry'
import type { FormFieldInstance } from '../submissions/types'
import { defaultValidationRules } from './builtin'
import { buildRuleRegistry } from './registry'
import { runValidation } from './runValidation'

const fieldRegistry = buildRegistry(defaultFieldDefinitions)
const ruleRegistry = buildRuleRegistry(defaultValidationRules)
const t = (key: string) => key

const run = (field: FormFieldInstance, value: unknown, answers: Record<string, unknown> = {}) =>
	runValidation({
		field,
		fieldDefinition: fieldRegistry.get(field.blockType),
		value,
		fieldType: field.blockType,
		ruleRegistry,
		answers,
		locale: 'en',
		t,
		operation: 'create',
		event: 'submit',
		mode: 'server',
	})

describe('runValidation', () => {
	it('reports required on an empty required field', async () => {
		const result = await run({ blockType: 'text', name: 'a', required: true }, '')
		expect(result.errors).toEqual([
			{ message: 'formBuilder:validation.required', severity: 'error' },
		])
	})

	it('runs the field intrinsic validator (email shape)', async () => {
		const result = await run({ blockType: 'email', name: 'e' }, 'nope')
		expect(result.errors).toEqual([{ message: 'formBuilder:validation.email', severity: 'error' }])
	})

	it('runs a declarative rule instance with a custom message', async () => {
		const field: FormFieldInstance = {
			blockType: 'text',
			name: 'a',
			validations: [{ blockType: 'minLength', min: 3, message: 'Too short: {min}' }],
		}
		const result = await run(field, 'ab')
		expect(result.errors).toEqual([{ message: 'Too short: 3', severity: 'error' }])
	})

	it('falls back to the localized default message when no override is set', async () => {
		const field: FormFieldInstance = {
			blockType: 'text',
			name: 'a',
			validations: [{ blockType: 'minLength', min: 3 }],
		}
		const result = await run(field, 'ab')
		expect(result.errors).toEqual([
			{ message: 'formBuilder:rule.minLength.message', severity: 'error' },
		])
	})

	it('honors a rule instance severity of warning', async () => {
		const field: FormFieldInstance = {
			blockType: 'text',
			name: 'a',
			validations: [{ blockType: 'minLength', min: 3, severity: 'warning' }],
		}
		const result = await run(field, 'ab')
		expect(result.errors).toEqual([
			{ message: 'formBuilder:rule.minLength.message', severity: 'warning' },
		])
	})

	it('skips server-only rules in client mode', async () => {
		const field: FormFieldInstance = {
			blockType: 'text',
			name: 'a',
			validations: [{ blockType: 'notAlreadySubmitted' }],
		}
		const result = await runValidation({
			field,
			fieldDefinition: fieldRegistry.get('text'),
			value: 'x',
			fieldType: 'text',
			ruleRegistry,
			answers: {},
			locale: 'en',
			t,
			operation: 'create',
			event: 'onChange',
			mode: 'client',
		})
		expect(result.errors).toEqual([])
	})

	it('resolves cross-field matchesField against the answers map', async () => {
		const field: FormFieldInstance = {
			blockType: 'text',
			name: 'confirm',
			validations: [{ blockType: 'matchesField', field: 'password' }],
		}
		const ok = await run(field, 'secret', { password: 'secret', confirm: 'secret' })
		expect(ok.errors).toEqual([])
		const bad = await run(field, 'secret', { password: 'other', confirm: 'secret' })
		expect(bad.errors).toEqual([
			{ message: 'formBuilder:rule.matchesField.message', severity: 'error' },
		])
	})

	it('skips validation entirely for an optional empty field', async () => {
		const field: FormFieldInstance = {
			blockType: 'text',
			name: 'a',
			validations: [{ blockType: 'minLength', min: 3 }],
		}
		const result = await run(field, '')
		expect(result.errors).toEqual([])
	})
})
