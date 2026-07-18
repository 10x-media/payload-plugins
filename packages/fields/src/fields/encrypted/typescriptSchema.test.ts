import { describe, expect, it } from 'vitest'
import { typescriptSchemaFor } from './typescriptSchema'

const run = (source: Parameters<typeof typescriptSchemaFor>[0]) => {
	const [fn] = typescriptSchemaFor(source)
	return (fn as NonNullable<typeof fn>)({ jsonSchema: {} })
}

describe('typescriptSchemaFor keeps original type shapes in generated types', () => {
	it('string-backed types', () => {
		expect(run({ name: 'a', type: 'text' })).toEqual({ type: 'string' })
		expect(run({ name: 'a', type: 'email' })).toEqual({ type: 'string' })
		expect(run({ name: 'a', type: 'date' })).toEqual({ type: 'string' })
	})

	it('number and boolean', () => {
		expect(run({ name: 'a', type: 'number' })).toEqual({ type: 'number' })
		expect(run({ name: 'a', type: 'checkbox' })).toEqual({ type: 'boolean' })
	})

	it('select/radio enum of option values, hasMany wraps in array', () => {
		expect(run({ name: 'a', options: ['x', { label: 'Y', value: 'y' }], type: 'select' })).toEqual({
			enum: ['x', 'y'],
			type: 'string',
		})
		expect(run({ hasMany: true, name: 'a', options: ['x', 'y'], type: 'select' })).toEqual({
			items: { enum: ['x', 'y'], type: 'string' },
			type: 'array',
		})
	})

	it('point tuple and object types', () => {
		expect(run({ name: 'a', type: 'point' })).toEqual({
			items: { type: 'number' },
			maxItems: 2,
			minItems: 2,
			type: 'array',
		})
		expect(run({ name: 'a', type: 'json' })).toEqual({
			additionalProperties: true,
			type: 'object',
		})
		expect(run({ name: 'a', type: 'richText' })).toEqual({
			additionalProperties: true,
			type: 'object',
		})
	})

	it('hasMany text', () => {
		expect(run({ hasMany: true, name: 'a', type: 'text' })).toEqual({
			items: { type: 'string' },
			type: 'array',
		})
	})
})
