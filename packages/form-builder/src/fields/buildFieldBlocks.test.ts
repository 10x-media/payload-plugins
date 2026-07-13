import type { Field } from 'payload'
import { describe, expect, it } from 'vitest'
import { defaultValidationRules } from '../validation/builtin'
import { buildRuleRegistry } from '../validation/registry'
import { buildFieldBlocks } from './buildFieldBlocks'
import { defaultFieldDefinitions } from './builtin'
import { buildRegistry } from './registry'

const fieldName = (field: Field) => ('name' in field ? field.name : undefined)

describe('buildFieldBlocks', () => {
	const blocks = buildFieldBlocks(
		buildRegistry(defaultFieldDefinitions),
		buildRuleRegistry(defaultValidationRules)
	)

	it('builds one block per registered type in registry order', () => {
		expect(blocks.map((block) => block.slug)).toEqual([
			'text',
			'textarea',
			'email',
			'number',
			'select',
			'checkbox',
			'calculation',
			'consent',
			'file',
			'repeater',
			'date',
		])
	})

	it('prepends the shared config and appends the type config', () => {
		const select = blocks.find((block) => block.slug === 'select')
		const names = select?.fields.map(fieldName) ?? []
		expect(names).toContain('name')
		expect(names).toContain('options')
		expect(names.indexOf('name')).toBeLessThan(names.indexOf('options'))
	})

	it('gives type-config-free blocks only the shared config', () => {
		const text = blocks.find((block) => block.slug === 'text')
		const names = text?.fields.map(fieldName) ?? []
		expect(names).toEqual([
			'name',
			'label',
			'required',
			'width',
			'placeholder',
			'description',
			undefined,
			'validations',
		])
		expect(text?.fields[6]?.type).toBe('collapsible')
	})
})
