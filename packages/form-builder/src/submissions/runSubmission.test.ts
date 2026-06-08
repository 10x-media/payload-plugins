import { describe, expect, it } from 'vitest'
import { defaultFieldDefinitions } from '../fields/builtin'
import { buildRegistry } from '../fields/registry'
import { runSubmission } from './runSubmission'
import type { FormFieldInstance } from './types'

const registry = buildRegistry(defaultFieldDefinitions)
const t = (key: string) => key
const base = { registry, locale: 'en', t }

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
})
