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
	it('gives each rule block its params plus message and severity', () => {
		const minLength = buildRuleBlocks(registry, 'text').find((block) => block.slug === 'minLength')
		const names = (minLength?.fields ?? []).map((field) =>
			'name' in field ? field.name : undefined
		)
		expect(names).toEqual(['min', 'message', 'severity'])
	})
	it('defaults severity to error and refuses to let it be cleared', () => {
		for (const block of buildRuleBlocks(registry, 'text')) {
			const severity = block.fields.find((field) => 'name' in field && field.name === 'severity')
			expect(severity).toMatchObject({
				type: 'select',
				defaultValue: 'error',
				admin: { isClearable: false },
			})
		}
	})
	it('throws when a custom rule declares a reserved param name', () => {
		const bad = buildRuleRegistry([
			defineValidationRule({
				type: 'bad',
				label: 'Bad',
				defaultMessage: 'm',
				params: [{ name: 'severity', type: 'text' }],
				validate: () => true,
			}) as AnyValidationRuleDefinition,
		])
		expect(() => buildRuleBlocks(bad, 'text')).toThrow(/reserved param name/)
	})
})
