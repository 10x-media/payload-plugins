import { describe, expect, it } from 'vitest'
import type { AnyFormFieldDefinition } from '../fields/types'
import type { FormFieldInstance } from '../submissions/types'
import { buildRecallResolver, optionLabelsFor } from './resolver'

const registry = new Map<string, AnyFormFieldDefinition>([
	['text', { type: 'text', label: 't', value: 'text' }],
	[
		'select',
		{
			type: 'select',
			label: 's',
			value: 'text',
			format: ({ value, optionLabels }) => optionLabels?.[String(value)] ?? String(value),
		},
	],
])
const fields: FormFieldInstance[] = [
	{ blockType: 'text', name: 'first', label: 'First' },
	{
		blockType: 'select',
		name: 'plan',
		label: 'Plan',
		options: [{ label: 'Pro plan', value: 'pro' }],
	},
]

describe('buildRecallResolver', () => {
	const resolve = buildRecallResolver({
		fields,
		values: { first: 'Ada', plan: 'pro' },
		registry,
		locale: 'en',
		t: (k) => k,
	})
	it('resolves a plain value', () => expect(resolve('first')).toBe('Ada'))
	it('formats via the field type format (option label)', () =>
		expect(resolve('plan')).toBe('Pro plan'))
	it('returns empty for unknown or empty', () => {
		expect(resolve('nope')).toBe('')
		expect(
			buildRecallResolver({ fields, values: {}, registry, locale: 'en', t: (k) => k })('first')
		).toBe('')
	})
	it('returns empty for null, undefined, and empty-array values', () => {
		const r = buildRecallResolver({
			fields: [
				{ blockType: 'text', name: 'a', label: 'A' },
				{ blockType: 'text', name: 'b', label: 'B' },
				{ blockType: 'text', name: 'c', label: 'C' },
			],
			values: { a: null, b: undefined, c: [] },
			registry,
			locale: 'en',
			t: (k) => k,
		})
		expect(r('a')).toBe('')
		expect(r('b')).toBe('')
		expect(r('c')).toBe('')
	})
	it('joins an array value when the field type has no format', () => {
		const r = buildRecallResolver({
			fields: [{ blockType: 'text', name: 'tags', label: 'Tags' }],
			values: { tags: ['a', 'b'] },
			registry,
			locale: 'en',
			t: (k) => k,
		})
		expect(r('tags')).toBe('a, b')
	})
})

describe('optionLabelsFor', () => {
	it('maps each option value to its label', () => {
		expect(
			optionLabelsFor({
				blockType: 'select',
				name: 's',
				options: [{ label: 'Pro plan', value: 'pro' }],
			})
		).toEqual({ pro: 'Pro plan' })
	})
	it('returns undefined when there are no usable options', () => {
		expect(optionLabelsFor({ blockType: 'text', name: 't' })).toBeUndefined()
		expect(optionLabelsFor({ blockType: 'select', name: 's', options: [] })).toBeUndefined()
	})
})
