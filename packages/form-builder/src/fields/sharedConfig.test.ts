import type { Field, TabsField } from 'payload'
import { describe, expect, it } from 'vitest'
import { fieldBlockTabs, sharedFieldConfig } from './sharedConfig'

const nameOf = (field: Field) => ('name' in field ? field.name : undefined)

const sampleConditionTypes = { text: 'text', number: 'number' } as const

const buildTabs = (typeConfig: Field[] = []) =>
	fieldBlockTabs({
		conditionTypes: sampleConditionTypes,
		typeConfig,
		validations: { name: 'validations', type: 'blocks', blocks: [] },
	}) as TabsField

const tabFields = (tabs: TabsField, index: number): Field[] => tabs.tabs[index]?.fields ?? []

describe('sharedFieldConfig', () => {
	it('lists the shared basics in order', () => {
		expect(sharedFieldConfig().map(nameOf)).toEqual([
			'name',
			'label',
			'required',
			'width',
			'placeholder',
			'description',
		])
	})

	it('makes name required', () => {
		const name = sharedFieldConfig().find((field) => 'name' in field && field.name === 'name')
		expect(name && 'required' in name && name.required).toBe(true)
	})

	it('localizes content fields by default and never identifiers or flags', () => {
		const localizedNames = sharedFieldConfig()
			.filter((field) => 'localized' in field && field.localized === true)
			.map(nameOf)
		expect(localizedNames).toEqual(['label', 'placeholder', 'description'])
	})

	it('omits the localized flag entirely when localize is false', () => {
		for (const field of sharedFieldConfig(false)) {
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
		expect(tabFields(tabs, 0).map(nameOf)).toEqual([
			'name',
			'label',
			'required',
			'width',
			'placeholder',
			'description',
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
