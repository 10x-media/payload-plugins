import { describe, expect, it } from 'vitest'
import { defineValidationRule } from './defineValidationRule'
import { buildRuleRegistry, resolveValidationRules } from './registry'
import type { AnyValidationRuleDefinition } from './types'

const make = (type: string) =>
	defineValidationRule({
		type,
		label: type,
		defaultMessage: 'm',
		validate: () => true,
	}) as AnyValidationRuleDefinition

const a = make('a')
const b = make('b')

describe('resolveValidationRules', () => {
	const defaults = [a, b]
	it('returns all defaults by default', () => {
		expect([...resolveValidationRules(defaults).keys()]).toEqual(['a', 'b'])
	})
	it('removes a rule with false', () => {
		expect(resolveValidationRules(defaults, { a: false }).has('a')).toBe(false)
	})
	it('keeps a rule with true', () => {
		expect(resolveValidationRules(defaults, { a: true }).has('a')).toBe(true)
	})
	it('adds or replaces with an object, forcing the key', () => {
		const a2 = make('ignored')
		const registry = resolveValidationRules(defaults, { a: a2, c: make('c') })
		expect(registry.get('a')?.type).toBe('a')
		expect(registry.get('c')?.type).toBe('c')
	})
})

describe('buildRuleRegistry', () => {
	it('keys rules by type', () => {
		expect(buildRuleRegistry([a, b]).get('b')?.label).toBe('b')
	})
})
