import type { PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'
import { matchesFieldRule } from './matchesField'

const base = {
	data: {},
	field: { blockType: 'text', name: 'confirm' },
	fieldType: 'text',
	operation: 'create' as const,
	event: 'submit' as const,
	locale: 'en',
	message: () => 'mismatch',
}

type FieldParam = {
	required?: boolean
	admin?: { components?: { Field?: { path?: string } } }
	validate?: (value: unknown, opts: { data?: unknown; req: PayloadRequest }) => string | true
}

const fieldParam = matchesFieldRule.params?.find(
	(field) => 'name' in field && field.name === 'field'
) as FieldParam | undefined

const req = { t: (key: string) => key } as unknown as PayloadRequest

describe('matchesFieldRule', () => {
	it('passes when the sibling matches', () => {
		expect(
			matchesFieldRule.validate({
				...base,
				value: 'secret',
				params: { field: 'password' },
				siblingData: { password: 'secret' },
			})
		).toBe(true)
	})
	it('fails when the sibling differs', () => {
		expect(
			matchesFieldRule.validate({
				...base,
				value: 'secret',
				params: { field: 'password' },
				siblingData: { password: 'other' },
			})
		).toBe('mismatch')
	})
	it('targets another field via the FieldNameSelect picker', () => {
		expect(fieldParam?.required).toBe(true)
		expect(fieldParam?.admin?.components?.Field?.path).toBe(
			'@10x-media/form-builder/client#FieldNameSelect'
		)
	})
	it('validates the chosen field still exists at save time', () => {
		const data = { fields: [{ blockType: 'text', name: 'password' }] }
		expect(fieldParam?.validate?.('password', { data, req })).toBe(true)
		expect(fieldParam?.validate?.('ghost', { data, req })).toBe(
			'formBuilder:rule.fieldTargetInvalid'
		)
	})
})
