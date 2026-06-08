import { describe, expect, it } from 'vitest'
import { defineFormField } from './defineFormField'
import { buildRegistry, resolveFieldTypes } from './registry'
import type { AnyFormFieldDefinition } from './types'

const a = defineFormField<'text'>({
	type: 'a',
	label: 'A',
	value: 'text',
}) as AnyFormFieldDefinition
const b = defineFormField<'number'>({
	type: 'b',
	label: 'B',
	value: 'number',
}) as AnyFormFieldDefinition

describe('buildRegistry', () => {
	it('keys definitions by type', () => {
		const registry = buildRegistry([a, b])
		expect(registry.get('a')?.label).toBe('A')
		expect([...registry.keys()]).toEqual(['a', 'b'])
	})
})

describe('resolveFieldTypes', () => {
	const defaults = [a, b]

	it('returns all built-ins by default', () => {
		expect([...resolveFieldTypes(defaults).keys()]).toEqual(['a', 'b'])
	})

	it('removes a type with false', () => {
		const registry = resolveFieldTypes(defaults, { a: false })
		expect(registry.has('a')).toBe(false)
		expect(registry.has('b')).toBe(true)
	})

	it('keeps a type with true', () => {
		expect(resolveFieldTypes(defaults, { a: true }).has('a')).toBe(true)
	})

	it('adds a new type with an object', () => {
		const c = defineFormField<'text'>({
			type: 'c',
			label: 'C',
			value: 'text',
		}) as AnyFormFieldDefinition
		expect(resolveFieldTypes(defaults, { c }).get('c')?.type).toBe('c')
	})

	it('replaces an existing type with an object and forces its key', () => {
		const a2 = defineFormField<'text'>({
			type: 'ignored',
			label: 'A2',
			value: 'text',
		}) as AnyFormFieldDefinition
		const registry = resolveFieldTypes(defaults, { a: a2 })
		expect(registry.get('a')?.label).toBe('A2')
		expect(registry.get('a')?.type).toBe('a')
	})
})
