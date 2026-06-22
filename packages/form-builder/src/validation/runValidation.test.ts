import type { PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'
import { defaultFieldDefinitions } from '../fields/builtin'
import { buildRegistry } from '../fields/registry'
import type { AnyFormFieldDefinition } from '../fields/types'
import type { FormFieldInstance } from '../submissions/types'
import { defaultValidationRules } from './builtin'
import { defineValidationRule } from './defineValidationRule'
import { buildRuleRegistry } from './registry'
import { runValidation } from './runValidation'
import type { AnyValidationRuleDefinition } from './types'

const fieldRegistry = buildRegistry(defaultFieldDefinitions)
const ruleRegistry = buildRuleRegistry(defaultValidationRules)
const throwingRule = defineValidationRule({
	type: 'throwing',
	label: 'Throwing',
	defaultMessage: 'm',
	validate: () => {
		throw new Error('boom')
	},
})
const slowRule = defineValidationRule({
	type: 'slow',
	label: 'Slow',
	defaultMessage: 'm',
	client: false,
	validate: () => new Promise<true>((resolve) => setTimeout(() => resolve(true), 50)),
})
const wantsReqRule = defineValidationRule({
	type: 'wantsReq',
	label: 'WantsReq',
	defaultMessage: 'has req',
	validate: ({ req, message }) => (req ? message() : true),
})
const extendedRegistry = buildRuleRegistry([
	...defaultValidationRules,
	throwingRule as AnyValidationRuleDefinition,
	slowRule as AnyValidationRuleDefinition,
	wantsReqRule as AnyValidationRuleDefinition,
])
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

	it('fails open when a declarative rule throws', async () => {
		const result = await runValidation({
			field: { blockType: 'text', name: 'a', validations: [{ blockType: 'throwing' }] },
			fieldDefinition: fieldRegistry.get('text'),
			value: 'x',
			fieldType: 'text',
			ruleRegistry: extendedRegistry,
			answers: {},
			locale: 'en',
			t,
			operation: 'create',
			event: 'submit',
			mode: 'server',
		})
		expect(result.errors).toEqual([])
	})

	it('fails open when an async rule exceeds the timeout', async () => {
		const result = await runValidation({
			field: { blockType: 'text', name: 'a', validations: [{ blockType: 'slow' }] },
			fieldDefinition: fieldRegistry.get('text'),
			value: 'x',
			fieldType: 'text',
			ruleRegistry: extendedRegistry,
			answers: {},
			locale: 'en',
			t,
			operation: 'create',
			event: 'submit',
			mode: 'server',
			timeoutMs: 5,
		})
		expect(result.errors).toEqual([])
	})

	it('fails open when the intrinsic field validator throws', async () => {
		const throwingField = {
			type: 'boom',
			label: 'Boom',
			value: 'text',
			validate: () => {
				throw new Error('boom')
			},
		} as AnyFormFieldDefinition
		const result = await runValidation({
			field: { blockType: 'boom', name: 'a' },
			fieldDefinition: throwingField,
			value: 'x',
			fieldType: 'boom',
			ruleRegistry: extendedRegistry,
			answers: {},
			locale: 'en',
			t,
			operation: 'create',
			event: 'submit',
			mode: 'server',
		})
		expect(result.errors).toEqual([])
	})

	it('nulls server-only context for a client-enabled rule in client mode', async () => {
		const result = await runValidation({
			field: { blockType: 'text', name: 'a', validations: [{ blockType: 'wantsReq' }] },
			fieldDefinition: fieldRegistry.get('text'),
			value: 'x',
			fieldType: 'text',
			ruleRegistry: extendedRegistry,
			answers: {},
			locale: 'en',
			t,
			operation: 'create',
			event: 'onChange',
			mode: 'client',
			req: {} as unknown as PayloadRequest,
		})
		expect(result.errors).toEqual([])
	})

	it('does not interpolate reserved instance keys into custom messages', async () => {
		const field: FormFieldInstance = {
			blockType: 'text',
			name: 'a',
			validations: [
				{ blockType: 'minLength', min: 3, message: 'min {min} sev {severity}', severity: 'error' },
			],
		}
		const result = await run(field, 'ab')
		expect(result.errors).toEqual([{ message: 'min 3 sev {severity}', severity: 'error' }])
	})

	it('runs a field-definition Standard Schema and maps its issues', async () => {
		const schema = {
			'~standard': {
				version: 1 as const,
				vendor: 'test',
				validate: (value: unknown) =>
					typeof value === 'string' && value.startsWith('x')
						? { value }
						: { issues: [{ message: 'must start with x' }] },
			},
		}
		const result = await runValidation({
			field: { blockType: 'text', name: 'a' },
			fieldDefinition: { type: 'text', label: 'Text', value: 'text', schema },
			value: 'nope',
			fieldType: 'text',
			ruleRegistry,
			answers: {},
			locale: 'en',
			t,
			operation: 'create',
			event: 'submit',
			mode: 'server',
		})
		expect(result.errors).toEqual([{ message: 'must start with x', severity: 'error' }])
	})
})
