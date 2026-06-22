import { describe, expect, it } from 'vitest'
import type { FormFieldInstance } from '../submissions/types'
import { buildFieldTypeRegistry, buildValidationRuleRegistry, visibleFields } from './resolveForm'

const fields: FormFieldInstance[] = [
	{ blockType: 'text', name: 'a' },
	{ blockType: 'text', name: 'b', visibleWhen: { a: { equals: 'show' } } },
]

describe('visibleFields', () => {
	it('keeps fields with no condition and those whose visibleWhen matches', () => {
		expect(visibleFields(fields, { a: 'show' }).map((f) => f.name)).toEqual(['a', 'b'])
	})

	it('drops a field whose visibleWhen does not match', () => {
		expect(visibleFields(fields, { a: 'no' }).map((f) => f.name)).toEqual(['a'])
	})
})

describe('buildFieldTypeRegistry', () => {
	it('returns a non-empty Map containing built-in types', () => {
		const registry = buildFieldTypeRegistry()
		expect(registry.size).toBeGreaterThan(0)
		expect(registry.has('text')).toBe(true)
	})

	it('merges extra definitions', () => {
		const registry = buildFieldTypeRegistry([{ type: 'custom', label: 'Custom', value: 'text' }])
		expect(registry.has('custom')).toBe(true)
		expect(registry.has('text')).toBe(true)
	})
})

describe('buildValidationRuleRegistry', () => {
	it('returns a non-empty Map containing built-in rules', () => {
		const registry = buildValidationRuleRegistry()
		expect(registry.size).toBeGreaterThan(0)
		expect(registry.has('minLength')).toBe(true)
	})
})
