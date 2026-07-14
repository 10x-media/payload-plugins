import type { Payload } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { defaultFieldDefinitions } from '../fields/builtin'
import { buildRegistry } from '../fields/registry'
import { defaultValidationRules } from '../validation/builtin'
import { buildRuleRegistry } from '../validation/registry'
import { runSubmission } from './runSubmission'
import type { FormFieldInstance } from './types'

const registry = buildRegistry(defaultFieldDefinitions)
const ruleRegistry = buildRuleRegistry(defaultValidationRules)
const consentRegistry = new Map()
const t = (key: string) => key
const base = {
	registry,
	ruleRegistry,
	consentRegistry,
	locale: 'en',
	t,
	operation: 'create' as const,
}

describe('runSubmission', () => {
	it('validates required and email, snapshots descriptors, returns typed values', async () => {
		const fields: FormFieldInstance[] = [
			{ blockType: 'text', name: 'fullName', label: 'Full name', required: true },
			{ blockType: 'email', name: 'email', label: 'Email', required: true },
		]
		const result = await runSubmission({
			...base,
			fields,
			values: [
				{ field: 'fullName', value: 'Ada' },
				{ field: 'email', value: 'ada@x.com' },
			],
		})
		expect(result.errors).toEqual([])
		expect(result.descriptors).toEqual([
			{ field: 'fullName', label: 'Full name', fieldType: 'text' },
			{ field: 'email', label: 'Email', fieldType: 'email' },
		])
		expect(result.values).toEqual([
			{ field: 'fullName', value: 'Ada' },
			{ field: 'email', value: 'ada@x.com' },
		])
	})

	it('reports a per-field error for a missing required field', async () => {
		const fields: FormFieldInstance[] = [
			{ blockType: 'text', name: 'fullName', label: 'Full name', required: true },
		]
		const result = await runSubmission({ ...base, fields, values: [] })
		expect(result.errors).toEqual([
			{ path: 'fullName', message: 'formBuilder:validation.required' },
		])
	})

	it('reports a format error for a bad email', async () => {
		const fields: FormFieldInstance[] = [
			{ blockType: 'email', name: 'email', label: 'Email', required: true },
		]
		const result = await runSubmission({
			...base,
			fields,
			values: [{ field: 'email', value: 'nope' }],
		})
		expect(result.errors).toEqual([{ path: 'email', message: 'formBuilder:validation.email' }])
	})

	it('coerces number values and snapshots select option labels', async () => {
		const fields: FormFieldInstance[] = [
			{ blockType: 'number', name: 'age', label: 'Age' },
			{
				blockType: 'select',
				name: 'plan',
				label: 'Plan',
				options: [
					{ label: 'Free', value: 'free' },
					{ label: 'Pro', value: 'pro' },
				],
			},
		]
		const result = await runSubmission({
			...base,
			fields,
			values: [
				{ field: 'age', value: '42' },
				{ field: 'plan', value: 'pro' },
			],
		})
		expect(result.values).toEqual([
			{ field: 'age', value: 42 },
			{ field: 'plan', value: 'pro' },
		])
		const planDescriptor = result.descriptors.find((descriptor) => descriptor.field === 'plan')
		expect(planDescriptor?.optionLabels).toEqual({ free: 'Free', pro: 'Pro' })
	})

	it('rejects a select value outside its options', async () => {
		const fields: FormFieldInstance[] = [
			{
				blockType: 'select',
				name: 'plan',
				label: 'Plan',
				required: true,
				options: [{ label: 'Free', value: 'free' }],
			},
		]
		const result = await runSubmission({
			...base,
			fields,
			values: [{ field: 'plan', value: 'enterprise' }],
		})
		expect(result.errors).toEqual([{ path: 'plan', message: 'formBuilder:validation.select' }])
	})

	it('skips optional empty fields (no value, no descriptor)', async () => {
		const fields: FormFieldInstance[] = [{ blockType: 'text', name: 'nickname', label: 'Nickname' }]
		const result = await runSubmission({ ...base, fields, values: [] })
		expect(result.values).toEqual([])
		expect(result.descriptors).toEqual([])
	})

	it('ignores values for unknown field types', async () => {
		const fields: FormFieldInstance[] = [{ blockType: 'mystery', name: 'x', label: 'X' }]
		const result = await runSubmission({ ...base, fields, values: [{ field: 'x', value: 'y' }] })
		expect(result.errors).toEqual([])
		expect(result.values).toEqual([])
		expect(result.descriptors).toEqual([])
	})

	it('rejects a non-numeric value for a number field', async () => {
		const fields: FormFieldInstance[] = [{ blockType: 'number', name: 'age', label: 'Age' }]
		const result = await runSubmission({
			...base,
			fields,
			values: [{ field: 'age', value: 'abc' }],
		})
		expect(result.errors).toEqual([{ path: 'age', message: 'formBuilder:validation.number' }])
		expect(result.values).toEqual([])
	})

	it('coerces a checkbox string "false" to the boolean false, never a truthy string', async () => {
		const fields: FormFieldInstance[] = [{ blockType: 'checkbox', name: 'agree', label: 'Agree' }]
		const result = await runSubmission({
			...base,
			fields,
			values: [{ field: 'agree', value: 'false' }],
		})
		expect(result.values).toEqual([{ field: 'agree', value: false }])
	})

	it('rejects a required consent submitted as the string "false"', async () => {
		const fields: FormFieldInstance[] = [{ blockType: 'consent', name: 'terms', label: 'I agree' }]
		const result = await runSubmission({
			...base,
			fields,
			values: [{ field: 'terms', value: 'false' }],
		})
		expect(result.errors).toHaveLength(1)
		expect(result.errors[0]?.path).toBe('terms')
	})

	it('enforces a declarative minLength rule with the coerced value', async () => {
		const fields: FormFieldInstance[] = [
			{
				blockType: 'text',
				name: 'code',
				label: 'Code',
				validations: [{ blockType: 'minLength', min: 4 }],
			},
		]
		const result = await runSubmission({
			...base,
			fields,
			values: [{ field: 'code', value: 'ab' }],
		})
		expect(result.errors).toEqual([{ path: 'code', message: 'formBuilder:rule.minLength.message' }])
	})

	it('resolves matchesField against coerced sibling answers', async () => {
		const fields: FormFieldInstance[] = [
			{ blockType: 'number', name: 'a', label: 'A' },
			{
				blockType: 'number',
				name: 'b',
				label: 'B',
				validations: [{ blockType: 'matchesField', field: 'a' }],
			},
		]
		const ok = await runSubmission({
			...base,
			fields,
			values: [
				{ field: 'a', value: '5' },
				{ field: 'b', value: '5' },
			],
		})
		expect(ok.errors).toEqual([])
		expect(ok.values).toEqual([
			{ field: 'a', value: 5 },
			{ field: 'b', value: 5 },
		])
	})

	it('skips a hidden field entirely (no validation, no stored value)', async () => {
		const fields: FormFieldInstance[] = [
			{ blockType: 'text', name: 'plan', label: 'Plan' },
			{
				blockType: 'text',
				name: 'detail',
				label: 'Detail',
				required: true,
				visibleWhen: { or: [{ and: [{ plan: { equals: 'pro' } }] }] },
			},
		]
		const result = await runSubmission({
			...base,
			fields,
			values: [
				{ field: 'plan', value: 'free' },
				{ field: 'detail', value: '' },
			],
		})
		expect(result.errors).toEqual([])
		expect(result.values).toEqual([{ field: 'plan', value: 'free' }])
		expect(result.descriptors.map((descriptor) => descriptor.field)).toEqual(['plan'])
	})

	it('validates a visible conditional field', async () => {
		const fields: FormFieldInstance[] = [
			{ blockType: 'text', name: 'plan', label: 'Plan' },
			{
				blockType: 'text',
				name: 'detail',
				label: 'Detail',
				required: true,
				visibleWhen: { or: [{ and: [{ plan: { equals: 'pro' } }] }] },
			},
		]
		const result = await runSubmission({
			...base,
			fields,
			values: [
				{ field: 'plan', value: 'pro' },
				{ field: 'detail', value: '' },
			],
		})
		expect(result.errors).toEqual([{ path: 'detail', message: 'formBuilder:validation.required' }])
	})

	it('validateWhen false stores the value but skips validation', async () => {
		const fields: FormFieldInstance[] = [
			{ blockType: 'text', name: 'plan', label: 'Plan' },
			{
				blockType: 'text',
				name: 'code',
				label: 'Code',
				validations: [{ blockType: 'minLength', min: 4 }],
				validateWhen: { or: [{ and: [{ plan: { equals: 'pro' } }] }] },
			},
		]
		const result = await runSubmission({
			...base,
			fields,
			values: [
				{ field: 'plan', value: 'free' },
				{ field: 'code', value: 'ab' },
			],
		})
		expect(result.errors).toEqual([])
		expect(result.values).toContainEqual({ field: 'code', value: 'ab' })
	})

	it('fails a file field closed when no uploads collection is configured', async () => {
		const findByID = vi.fn()
		const payload = { findByID } as unknown as Payload
		const fields: FormFieldInstance[] = [{ blockType: 'file', name: 'resume', label: 'Resume' }]
		const result = await runSubmission({
			...base,
			fields,
			values: [{ field: 'resume', value: 'up1' }],
			payload,
		})
		expect(result.errors).toEqual([
			{ path: 'resume', message: 'formBuilder:validation.file.missing' },
		])
		expect(result.values).toEqual([])
		expect(findByID).not.toHaveBeenCalled()
	})
})
