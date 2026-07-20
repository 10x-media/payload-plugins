import type { PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'
import { keys } from '../translations/keys'
import { fieldTargetParam } from './fieldTargetParam'

type FieldTargetField = {
	type: string
	required?: boolean
	admin?: {
		components?: {
			Field?: { path?: string; clientProps?: { types?: string[]; descriptionKey?: string } }
		}
	}
	validate?: (value: unknown, opts: { data?: unknown; req: PayloadRequest }) => string | true
}

const asField = (field: ReturnType<typeof fieldTargetParam>) => field as FieldTargetField
const req = { t: (key: string) => key } as unknown as PayloadRequest
const data = {
	fields: [
		{ blockType: 'text', name: 'alpha' },
		{ blockType: 'email', name: 'beta' },
	],
}

describe('fieldTargetParam', () => {
	it('returns a required text field mounting FieldNameSelect', () => {
		const field = asField(fieldTargetParam('field'))
		expect(field.type).toBe('text')
		expect(field.required).toBe(true)
		expect(field.admin?.components?.Field?.path).toBe(
			'@10x-media/form-builder/client#FieldNameSelect'
		)
	})
	it('passes the types filter through to the picker, undefined by default', () => {
		expect(
			asField(fieldTargetParam('field')).admin?.components?.Field?.clientProps?.types
		).toBeUndefined()
		expect(
			asField(fieldTargetParam('field', { types: ['email'] })).admin?.components?.Field?.clientProps
				?.types
		).toEqual(['email'])
	})
	it('can be made optional', () => {
		expect(asField(fieldTargetParam('field', { required: false })).required).toBe(false)
	})
	it('passes a description key through as a clientProp when given', () => {
		const field = asField(
			fieldTargetParam('field', { description: keys.ruleMatchesFieldDescription })
		)
		expect(field.admin?.components?.Field?.clientProps?.descriptionKey).toBe(
			'formBuilder:rule.matchesField.description'
		)
	})
	it('validate tolerates an empty value so required owns emptiness', () => {
		const field = asField(fieldTargetParam('field'))
		expect(field.validate?.('', { data, req })).toBe(true)
		expect(field.validate?.(undefined, { data, req })).toBe(true)
	})
	it('validate passes an existing field name and rejects a missing one', () => {
		const field = asField(fieldTargetParam('field'))
		expect(field.validate?.('alpha', { data, req })).toBe(true)
		expect(field.validate?.('beta', { data, req })).toBe(true)
		expect(field.validate?.('ghost', { data, req })).toBe('formBuilder:rule.fieldTargetInvalid')
	})
	it('validate honors a types filter, rejecting a name of the wrong type', () => {
		const field = asField(fieldTargetParam('field', { types: ['email'] }))
		expect(field.validate?.('beta', { data, req })).toBe(true)
		expect(field.validate?.('alpha', { data, req })).toBe('formBuilder:rule.fieldTargetInvalid')
	})
})
