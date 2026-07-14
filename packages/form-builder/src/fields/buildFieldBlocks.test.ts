import type { Block, Field, TabsField } from 'payload'
import { describe, expect, it } from 'vitest'
import { defaultValidationRules } from '../validation/builtin'
import { buildRuleRegistry } from '../validation/registry'
import { buildFieldBlocks } from './buildFieldBlocks'
import { defaultFieldDefinitions } from './builtin'
import { buildRegistry } from './registry'

const fieldName = (field: Field) => ('name' in field ? field.name : undefined)

/** Flattens rows (presentational, unnamed) so assertions can read data-path order. */
const flatten = (fields: Field[]): Field[] =>
	fields.flatMap((field) => (field.type === 'row' ? flatten(field.fields) : [field]))

const tabsOf = (block: Block | undefined): TabsField | undefined =>
	block?.fields.find((f): f is TabsField => f.type === 'tabs')

const tabFields = (block: Block | undefined, index: number): Field[] =>
	tabsOf(block)?.tabs[index]?.fields ?? []

const flatTabFields = (block: Block | undefined, index: number): Field[] =>
	flatten(tabFields(block, index))

describe('buildFieldBlocks', () => {
	const blocks = buildFieldBlocks({
		registry: buildRegistry(defaultFieldDefinitions),
		ruleRegistry: buildRuleRegistry(defaultValidationRules),
	})

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
		const names = flatTabFields(select, 0).map(fieldName)
		expect(names).toContain('name')
		expect(names).toContain('options')
		expect(names.indexOf('name')).toBeLessThan(names.indexOf('options'))
	})

	it('gives type-config-free blocks only the shared config in the Field tab', () => {
		const text = blocks.find((block) => block.slug === 'text')
		expect(flatTabFields(text, 0).map(fieldName)).toEqual([
			'name',
			'label',
			'width',
			'placeholder',
			'description',
			'required',
		])
	})

	it('lays out the shared basics as name+label and width+placeholder rows', () => {
		const text = blocks.find((block) => block.slug === 'text')
		const fields = tabFields(text, 0)
		const [nameLabelRow, widthPlaceholderRow] = fields
		expect(nameLabelRow?.type).toBe('row')
		expect(widthPlaceholderRow?.type).toBe('row')
		if (nameLabelRow?.type !== 'row' || widthPlaceholderRow?.type !== 'row') {
			throw new Error('expected row fields')
		}
		expect(nameLabelRow.fields.map(fieldName)).toEqual(['name', 'label'])
		expect(widthPlaceholderRow.fields.map(fieldName)).toEqual(['width', 'placeholder'])
	})

	it('makes the width select required and not clearable', () => {
		const text = blocks.find((block) => block.slug === 'text')
		const width = flatTabFields(text, 0).find((f) => 'name' in f && f.name === 'width')
		expect(width && 'required' in width && width.required).toBe(true)
		expect(width?.admin && 'isClearable' in width.admin && width.admin.isClearable).toBe(false)
	})

	it('puts validations and validateWhen in the Validation tab', () => {
		const text = blocks.find((block) => block.slug === 'text')
		expect(tabFields(text, 1).map(fieldName)).toEqual(['validations', 'validateWhen'])
	})

	it('puts visibleWhen and hidden in the Advanced tab', () => {
		const text = blocks.find((block) => block.slug === 'text')
		expect(tabFields(text, 2).map(fieldName)).toEqual(['visibleWhen', 'hidden'])
	})

	it('localizes the shared label field by default and not when localize is false', () => {
		const labelOf = (all: Block[]) =>
			flatTabFields(
				all.find((block) => block.slug === 'text'),
				0
			).find((f) => 'name' in f && f.name === 'label')
		expect(labelOf(blocks)).toMatchObject({ localized: true })
		const unlocalized = buildFieldBlocks({
			registry: buildRegistry(defaultFieldDefinitions),
			ruleRegistry: buildRuleRegistry(defaultValidationRules),
			localize: false,
		})
		expect('localized' in (labelOf(unlocalized) ?? {})).toBe(false)
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
