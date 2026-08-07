import type { FormState } from 'payload'
import { describe, expect, it } from 'vitest'

import { buildFieldSchemaMap } from '../schema/fieldSchema'
import { createVolatileMatcher, isUnparsedJson } from './volatileValues'

const field = (value: unknown): FormState[string] => ({ valid: true, value })

describe('isUnparsedJson', () => {
	it('is false for parsed data of any shape', () => {
		expect(isUnparsedJson({ test: '123' })).toBe(false)
		expect(isUnparsedJson([1, 2])).toBe(false)
		expect(isUnparsedJson(42)).toBe(false)
		expect(isUnparsedJson(true)).toBe(false)
		expect(isUnparsedJson(null)).toBe(false)
		expect(isUnparsedJson(undefined)).toBe(false)
	})

	it('is true for editor text the field could not parse', () => {
		expect(isUnparsedJson('{\n\t"test": \n}')).toBe(true)
		expect(isUnparsedJson('{"a":')).toBe(true)
		expect(isUnparsedJson('')).toBe(true)
	})

	it('is false for a string that is itself valid JSON', () => {
		expect(isUnparsedJson('123')).toBe(false)
		expect(isUnparsedJson('"quoted"')).toBe(false)
		expect(isUnparsedJson('{"a":1}')).toBe(false)
	})
})

describe('createVolatileMatcher', () => {
	const schema = buildFieldSchemaMap([
		{ name: 'metadata', type: 'json' },
		{ name: 'title', type: 'text' },
		{
			name: 'list',
			type: 'array',
			fields: [{ name: 'config', type: 'json' }],
		},
	])

	it('flags unparsed text on a json path', () => {
		const isVolatile = createVolatileMatcher(schema)
		expect(isVolatile('metadata', field('{"a":'))).toBe(true)
		expect(isVolatile('list.0.config', field('{"a":'))).toBe(true)
	})

	it('leaves parsed json values alone', () => {
		const isVolatile = createVolatileMatcher(schema)
		expect(isVolatile('metadata', field({ a: 1 }))).toBe(false)
		expect(isVolatile('metadata', field(null))).toBe(false)
	})

	it('never flags a path that is not json, whatever it holds', () => {
		const isVolatile = createVolatileMatcher(schema)
		expect(isVolatile('title', field('{"a":'))).toBe(false)
	})

	/**
	 * Two blocks declaring the same field name with different types collapse to
	 * one pattern with no resolvable type, and a form-state path carries no block
	 * discriminator. Reading the text field there as unfinished JSON would drop
	 * it from the history for as long as it held anything that does not parse,
	 * which is most of what a text field ever holds.
	 */
	it('skips a pattern whose type is ambiguous across blocks', () => {
		const ambiguous = buildFieldSchemaMap([
			{
				name: 'layout',
				type: 'blocks',
				blocks: [
					{ slug: 'a', fields: [{ name: 'data', type: 'json' }] },
					{ slug: 'b', fields: [{ name: 'data', type: 'text' }] },
				],
			},
		])
		expect(createVolatileMatcher(ambiguous)('layout.0.data', field('plain'))).toBe(false)
	})

	it('is never true without a schema', () => {
		expect(createVolatileMatcher(new Map())('metadata', field('{"a":'))).toBe(false)
	})
})
