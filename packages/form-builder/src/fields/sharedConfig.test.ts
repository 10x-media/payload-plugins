import type { Field, TabsField } from 'payload'
import { describe, expect, it } from 'vitest'
import { fieldBlockTabs, sharedFieldConfig } from './sharedConfig'
import type { OmittableSharedField } from './types'

const nameOf = (field: Field) => ('name' in field ? field.name : undefined)

/** Flattens rows (presentational, unnamed) so assertions can read data-path order. */
const flatten = (fields: Field[]): Field[] =>
	fields.flatMap((field) => (field.type === 'row' ? flatten(field.fields) : [field]))

const findNamed = (fields: Field[], name: string): Field | undefined =>
	flatten(fields).find((field) => 'name' in field && field.name === name)

/** Row nesting, names, and widths: everything `omitShared` can perturb, minus label fn identity. */
const shapeOf = (fields: Field[]): unknown[] =>
	fields.map((field) =>
		field.type === 'row'
			? { row: shapeOf(field.fields) }
			: { name: nameOf(field), width: field.admin?.width }
	)

const sampleConditionTypes = { text: 'text', number: 'number' } as const

const buildTabs = (typeConfig: Field[] = [], omitShared?: OmittableSharedField[]) =>
	fieldBlockTabs({
		conditionTypes: sampleConditionTypes,
		typeConfig,
		validations: { name: 'validations', type: 'blocks', blocks: [] },
		...(omitShared ? { omitShared } : {}),
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

describe('sharedFieldConfig omitShared', () => {
	it.each([
		['label', ['name', 'width', 'placeholder', 'description', 'required']],
		['placeholder', ['name', 'label', 'width', 'description', 'required']],
		['description', ['name', 'label', 'width', 'placeholder', 'required']],
		['width', ['name', 'label', 'placeholder', 'description', 'required']],
		['required', ['name', 'label', 'width', 'placeholder', 'description']],
	] as const)('drops %s and nothing else', (omitted, expected) => {
		expect(flatten(sharedFieldConfig(true, [omitted])).map(nameOf)).toEqual(expected)
	})

	it('drops several at once', () => {
		expect(flatten(sharedFieldConfig(true, ['placeholder', 'required'])).map(nameOf)).toEqual([
			'name',
			'label',
			'width',
			'description',
		])
	})

	it('changes nothing when the list is empty', () => {
		expect(shapeOf(sharedFieldConfig(true, []))).toEqual(shapeOf(sharedFieldConfig()))
	})

	it('keeps name, spanning its row, even when every omittable field is dropped', () => {
		const fields = sharedFieldConfig(true, [
			'label',
			'placeholder',
			'description',
			'width',
			'required',
		])
		expect(shapeOf(fields)).toEqual([{ row: [{ name: 'name', width: undefined }] }])
	})

	it('never drops name, even when an untyped caller asks for it', () => {
		const omitName = ['name'] as unknown as OmittableSharedField[]
		expect(findNamed(sharedFieldConfig(true, omitName), 'name')).toBeDefined()
	})

	it('rejects name at the type level', () => {
		// @ts-expect-error 'name' is deliberately absent from OmittableSharedField: it is the storage key.
		sharedFieldConfig(true, ['name'])
	})

	it('drops a row once both its fields are omitted', () => {
		const fields = sharedFieldConfig(true, ['width', 'placeholder'])
		expect(fields.filter((field) => field.type === 'row')).toHaveLength(1)
		expect(flatten(fields).map(nameOf)).toEqual(['name', 'label', 'description', 'required'])
	})

	it('keeps the row and lets the lone survivor span it when its sibling is omitted', () => {
		const [, widthRow] = sharedFieldConfig(true, ['placeholder'])
		expect(widthRow?.type).toBe('row')
		if (widthRow?.type !== 'row') {
			throw new Error('expected a row field')
		}
		expect(widthRow.fields.map(nameOf)).toEqual(['width'])
		// No admin.width at all: Payload renders a width-less row child as flex: 1 1 auto.
		expect(widthRow.fields[0]?.admin).not.toHaveProperty('width')
	})

	it('preserves the survivor other admin keys when it spans the row', () => {
		const [, widthRow] = sharedFieldConfig(true, ['placeholder'])
		if (widthRow?.type !== 'row') {
			throw new Error('expected a row field')
		}
		expect(widthRow.fields[0]?.admin).toMatchObject({ isClearable: false })
	})

	it('leaves both widths at 50% when the row keeps both fields', () => {
		const [, widthRow] = sharedFieldConfig(true, ['description'])
		if (widthRow?.type !== 'row') {
			throw new Error('expected a row field')
		}
		for (const field of widthRow.fields) {
			expect(field.admin?.width).toBe('50%')
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

	it('threads omitShared into the shared basics, leaving the type config alone', () => {
		const tabs = buildTabs([{ name: 'options', type: 'text' }], ['placeholder', 'required'])
		expect(flatten(tabFields(tabs, 0)).map(nameOf)).toEqual([
			'name',
			'label',
			'width',
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
