import type { Block, Field, TabsField } from 'payload'
import { describe, expect, it } from 'vitest'
import { defaultValidationRules } from '../validation/builtin'
import { buildRuleRegistry } from '../validation/registry'
import { buildFieldBlocks } from './buildFieldBlocks'
import { defaultFieldDefinitions } from './builtin'
import { buildRegistry } from './registry'

const fieldName = (field: Field) => ('name' in field ? field.name : undefined)

const tabsOf = (block: Block | undefined): TabsField | undefined =>
	block?.fields.find((f): f is TabsField => f.type === 'tabs')

const tabFields = (block: Block | undefined, index: number): Field[] =>
	tabsOf(block)?.tabs[index]?.fields ?? []

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

	it('gives every block a single unnamed tabs field', () => {
		for (const block of blocks) {
			expect(block.fields).toHaveLength(1)
			const tabs = tabsOf(block)
			expect(tabs?.tabs).toHaveLength(3)
			for (const tab of tabs?.tabs ?? []) {
				expect('name' in tab && tab.name).toBeFalsy()
			}
		}
	})

	it('puts shared config then type config in the Field tab', () => {
		const select = blocks.find((block) => block.slug === 'select')
		const names = tabFields(select, 0).map(fieldName)
		expect(names).toContain('name')
		expect(names).toContain('options')
		expect(names.indexOf('name')).toBeLessThan(names.indexOf('options'))
	})

	it('gives type-config-free blocks only the shared config in the Field tab', () => {
		const text = blocks.find((block) => block.slug === 'text')
		expect(tabFields(text, 0).map(fieldName)).toEqual([
			'name',
			'label',
			'required',
			'width',
			'placeholder',
			'description',
		])
	})

	it('puts validations and validateWhen in the Validation tab', () => {
		const text = blocks.find((block) => block.slug === 'text')
		expect(tabFields(text, 1).map(fieldName)).toEqual(['validations', 'validateWhen'])
	})

	it('puts visibleWhen and hidden in the Advanced tab', () => {
		const text = blocks.find((block) => block.slug === 'text')
		expect(tabFields(text, 2).map(fieldName)).toEqual(['visibleWhen', 'hidden'])
	})

	it('appends subFields to the repeater Field tab, excluding the repeater itself', () => {
		const repeater = blocks.find((block) => block.slug === 'repeater')
		const fieldTab = tabFields(repeater, 0)
		const subFields = fieldTab.find((f) => 'name' in f && f.name === 'subFields')
		expect(fieldTab[fieldTab.length - 1]).toBe(subFields)
		expect(subFields).toMatchObject({ type: 'blocks' })
		const subBlocks = (subFields as { blocks: Block[] }).blocks
		expect(subBlocks.map((b) => b.slug)).not.toContain('repeater')
		expect(subBlocks.length).toBe(blocks.length - 1)
	})
})
