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
	it('leads each rule block with its description, then params, then a message override', () => {
		const minLength = buildRuleBlocks(registry, 'text').find((block) => block.slug === 'minLength')
		const names = (minLength?.fields ?? []).map((field) =>
			'name' in field ? field.name : undefined
		)
		expect(names).toEqual(['minLengthDescription', 'min', 'message'])
	})
	it('mounts RuleDescription as the leading ui field carrying the rule description key', () => {
		const minLength = buildRuleBlocks(registry, 'text').find((block) => block.slug === 'minLength')
		const first = minLength?.fields?.[0]
		expect(first?.type).toBe('ui')
		const component = (first as { admin?: { components?: { Field?: unknown } } } | undefined)?.admin
			?.components?.Field as
			| { path?: string; clientProps?: { descriptionKey?: string } }
			| undefined
		expect(component?.path).toBe('@10x-media/form-builder/client#RuleDescription')
		expect(component?.clientProps?.descriptionKey).toBe('formBuilder:rule.minLength.description')
	})
	it('omits the description ui field for a rule that sets none', () => {
		const noDesc = buildRuleRegistry([
			defineValidationRule({
				type: 'noDesc',
				label: 'No desc',
				defaultMessage: 'm',
				validate: () => true,
			}) as AnyValidationRuleDefinition,
		])
		const block = buildRuleBlocks(noDesc, 'text').find((b) => b.slug === 'noDesc')
		const names = (block?.fields ?? []).map((field) => ('name' in field ? field.name : undefined))
		expect(names).toEqual(['message'])
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
