import { describe, expect, it } from 'vitest'
import { buildRuleBlocks } from './buildRuleBlocks'
import { defaultValidationRules } from './builtin'
import { defineValidationRule } from './defineValidationRule'
import { buildRuleRegistry } from './registry'
import type { AnyValidationRuleDefinition } from './types'

const registry = buildRuleRegistry(defaultValidationRules)

describe('buildRuleBlocks', () => {
	it('offers only rules whose appliesTo includes the field type', () => {
		const numberRules = buildRuleBlocks(registry, 'number').map((block) => block.slug)
		expect(numberRules).toContain('min')
		expect(numberRules).toContain('max')
		expect(numberRules).not.toContain('minLength')
	})
	it('offers unrestricted rules (no appliesTo) to every field type', () => {
		const slugs = buildRuleBlocks(registry, 'number').map((block) => block.slug)
		expect(slugs).toContain('matchesField')
		expect(slugs).toContain('notAlreadySubmitted')
	})
	it('gives each rule block its params plus a message override', () => {
		const minLength = buildRuleBlocks(registry, 'text').find((block) => block.slug === 'minLength')
		const names = (minLength?.fields ?? []).map((field) =>
			'name' in field ? field.name : undefined
		)
		expect(names).toEqual(['min', 'message'])
	})
	it('throws when a custom rule declares a reserved param name', () => {
		const bad = buildRuleRegistry([
			defineValidationRule({
				type: 'bad',
				label: 'Bad',
				defaultMessage: 'm',
				params: [{ name: 'message', type: 'text' }],
				validate: () => true,
			}) as AnyValidationRuleDefinition,
		])
		expect(() => buildRuleBlocks(bad, 'text')).toThrow(/reserved param name/)
	})
})
