import type { Field, TabsField } from 'payload'
import { describe, expect, it } from 'vitest'
import { fieldBlockTabs, sharedFieldConfig } from './sharedConfig'

const nameOf = (field: Field) => ('name' in field ? field.name : undefined)

/** Flattens rows (presentational, unnamed) so assertions can read data-path order. */
const flatten = (fields: Field[]): Field[] =>
	fields.flatMap((field) => (field.type === 'row' ? flatten(field.fields) : [field]))

const findNamed = (fields: Field[], name: string): Field | undefined =>
	flatten(fields).find((field) => 'name' in field && field.name === name)

const sampleConditionTypes = { text: 'text', number: 'number' } as const

const buildTabs = (typeConfig: Field[] = []) =>
	fieldBlockTabs({
		conditionTypes: sampleConditionTypes,
		typeConfig,
		validations: { name: 'validations', type: 'blocks', blocks: [] },
	}) as TabsField

const tabFields = (tabs: TabsField, index: number): Field[] => tabs.tabs[index]?.fields ?? []

describe('sharedFieldConfig', () => {
	it('lists the shared basics in order: name+label row, width+placeholder row, description, required', () => {
		expect(flatten(sharedFieldConfig()).map(nameOf)).toEqual([
			'name',
			'label',
			'width',
			'placeholder',
			'description',
			'required',
		])
	})

	it('groups name+label and width+placeholder into 50/50 rows', () => {
		const [nameLabelRow, widthPlaceholderRow] = sharedFieldConfig()
		expect(nameLabelRow?.type).toBe('row')
		expect(widthPlaceholderRow?.type).toBe('row')
		if (nameLabelRow?.type !== 'row' || widthPlaceholderRow?.type !== 'row') {
			throw new Error('expected row fields')
		}
		expect(nameLabelRow.fields.map(nameOf)).toEqual(['name', 'label'])
		expect(widthPlaceholderRow.fields.map(nameOf)).toEqual(['width', 'placeholder'])
		for (const field of [...nameLabelRow.fields, ...widthPlaceholderRow.fields]) {
			expect(field.admin?.width).toBe('50%')
		}
	})

	it('puts required last, under description', () => {
		const flat = flatten(sharedFieldConfig())
		expect(flat[flat.length - 1]).toMatchObject({ name: 'required', type: 'checkbox' })
	})

	it('makes name required', () => {
		const name = findNamed(sharedFieldConfig(), 'name')
		expect(name && 'required' in name && name.required).toBe(true)
	})

	it('makes width required and not clearable', () => {
		const width = findNamed(sharedFieldConfig(), 'width')
		expect(width && 'required' in width && width.required).toBe(true)
		expect(width?.admin && 'isClearable' in width.admin && width.admin.isClearable).toBe(false)
		expect(width && 'defaultValue' in width && width.defaultValue).toBe('full')
	})

	it('localizes content fields by default and never identifiers or flags', () => {
		const localizedNames = flatten(sharedFieldConfig())
			.filter((field) => 'localized' in field && field.localized === true)
			.map(nameOf)
		expect(localizedNames).toEqual(['label', 'placeholder', 'description'])
	})

	it('omits the localized flag entirely when localize is false', () => {
		for (const field of flatten(sharedFieldConfig(false))) {
			expect('localized' in field).toBe(false)
		}
	})
})

describe('fieldBlockTabs', () => {
	it('builds unnamed tabs so data paths stay flat', () => {
		const tabs = buildTabs()
		expect(tabs.type).toBe('tabs')
		expect(tabs.tabs).toHaveLength(3)
		for (const tab of tabs.tabs) {
			expect('name' in tab && tab.name).toBeFalsy()
			expect(tab.label).toBeDefined()
		}
	})

	it('puts the shared basics then the type config in the Field tab', () => {
		const tabs = buildTabs([{ name: 'options', type: 'text' }])
		expect(flatten(tabFields(tabs, 0)).map(nameOf)).toEqual([
			'name',
			'label',
			'width',
			'placeholder',
			'description',
			'required',
			'options',
		])
	})

	it('puts validations and validateWhen in the Validation tab', () => {
		const tabs = buildTabs()
		expect(tabFields(tabs, 1).map(nameOf)).toEqual(['validations', 'validateWhen'])
	})

	it('puts visibleWhen and hidden in the Advanced tab', () => {
		const tabs = buildTabs()
		expect(tabFields(tabs, 2).map(nameOf)).toEqual(['visibleWhen', 'hidden'])
	})

	it('mounts FormConditionField on visibleWhen and validateWhen', () => {
		const tabs = buildTabs()
		const conditionFields = [
			tabFields(tabs, 1).find((f) => 'name' in f && f.name === 'validateWhen'),
			tabFields(tabs, 2).find((f) => 'name' in f && f.name === 'visibleWhen'),
		]
		for (const field of conditionFields) {
			expect(field?.admin?.components?.Field).toMatchObject({
				path: '@10x-media/form-builder/client#FormConditionField',
				clientProps: { conditionTypes: sampleConditionTypes },
			})
		}
	})

	it('hidden is a checkbox in the Advanced tab', () => {
		const tabs = buildTabs()
		const hidden = tabFields(tabs, 2).find((f) => 'name' in f && f.name === 'hidden')
		expect(hidden).toMatchObject({ name: 'hidden', type: 'checkbox' })
	})
})
