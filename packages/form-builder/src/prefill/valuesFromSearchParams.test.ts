import { describe, expect, it } from 'vitest'
import type { FieldTypeRegistry } from '../fields/registry'
import type { AnyFormFieldDefinition } from '../fields/types'
import type { FormFieldInstance } from '../submissions/types'
import { valuesFromSearchParams } from './valuesFromSearchParams'

const registry: FieldTypeRegistry = new Map<string, AnyFormFieldDefinition>([
	['text', { type: 'text', label: 't', value: 'text' }],
	['number', { type: 'number', label: 'n', value: 'number' }],
	['checkbox', { type: 'checkbox', label: 'c', value: 'boolean' }],
	['multi', { type: 'multi', label: 'm', value: 'text[]' }],
])

const fields: FormFieldInstance[] = [
	{ blockType: 'text', name: 'name', label: 'Name' },
	{ blockType: 'number', name: 'age', label: 'Age' },
	{ blockType: 'checkbox', name: 'optin', label: 'Opt in' },
	{ blockType: 'multi', name: 'tags', label: 'Tags' },
]

describe('valuesFromSearchParams', () => {
	it('maps a known text field from URLSearchParams', () => {
		const params = new URLSearchParams({ name: 'Ada' })
		expect(valuesFromSearchParams(params, fields, registry)).toEqual({ name: 'Ada' })
	})

	it('coerces a number param', () => {
		const params = new URLSearchParams({ age: '30' })
		expect(valuesFromSearchParams(params, fields, registry)).toEqual({ age: 30 })
	})

	it('coerces checkbox truthy values', () => {
		for (const val of ['true', '1', 'on', 'yes']) {
			const params = new URLSearchParams({ optin: val })
			expect(valuesFromSearchParams(params, fields, registry)).toEqual({ optin: true })
		}
	})

	it('coerces checkbox falsy value', () => {
		const params = new URLSearchParams({ optin: 'false' })
		expect(valuesFromSearchParams(params, fields, registry)).toEqual({ optin: false })
	})

	it('ignores an unknown param', () => {
		const params = new URLSearchParams({ unknown: 'x', name: 'Ada' })
		expect(valuesFromSearchParams(params, fields, registry)).toEqual({ name: 'Ada' })
	})

	it('collects repeated params for a text[] field', () => {
		const params = new URLSearchParams([
			['tags', 'a'],
			['tags', 'b'],
		])
		expect(valuesFromSearchParams(params, fields, registry)).toEqual({ tags: ['a', 'b'] })
	})

	it('drops an invalid number', () => {
		const params = new URLSearchParams({ age: 'notanumber' })
		expect(valuesFromSearchParams(params, fields, registry)).toEqual({})
	})

	it('renames a param to a field via map option', () => {
		const params = new URLSearchParams({ n: 'Ada' })
		expect(valuesFromSearchParams(params, fields, registry, { map: { n: 'name' } })).toEqual({
			name: 'Ada',
		})
	})

	it('blocks a field via deny option', () => {
		const params = new URLSearchParams({ name: 'Ada', age: '30' })
		expect(valuesFromSearchParams(params, fields, registry, { deny: ['name'] })).toEqual({
			age: 30,
		})
	})

	it('restricts to allowed fields via allow option', () => {
		const params = new URLSearchParams({ name: 'Ada', age: '30' })
		expect(valuesFromSearchParams(params, fields, registry, { allow: ['age'] })).toEqual({
			age: 30,
		})
	})

	it('works with a plain Record<string, string> input', () => {
		const params: Record<string, string> = { name: 'Grace' }
		expect(valuesFromSearchParams(params, fields, registry)).toEqual({ name: 'Grace' })
	})
})
