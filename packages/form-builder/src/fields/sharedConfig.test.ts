import type { CollapsibleField, Field } from 'payload'
import { describe, expect, it } from 'vitest'
import { sharedFieldConfig } from './sharedConfig'

const nameOf = (field: Field) => ('name' in field ? field.name : undefined)

const sampleConditionTypes = { text: 'text', number: 'number' } as const

const advancedCollapsible = (fields: Field[]): CollapsibleField | undefined =>
	fields.find((f): f is CollapsibleField => f.type === 'collapsible')

describe('sharedFieldConfig', () => {
	it('lists basic fields at the top level, then an Advanced collapsible', () => {
		const fields = sharedFieldConfig(sampleConditionTypes)
		const topLevelNames = fields.map(nameOf)
		expect(topLevelNames).toEqual([
			'name',
			'label',
			'required',
			'width',
			'placeholder',
			'description',
			undefined,
		])
		expect(fields[fields.length - 1]?.type).toBe('collapsible')
	})

	it('makes name required', () => {
		const name = sharedFieldConfig(sampleConditionTypes).find(
			(field) => 'name' in field && field.name === 'name'
		)
		expect(name && 'required' in name && name.required).toBe(true)
	})

	it('Advanced collapsible is collapsed by default', () => {
		const fields = sharedFieldConfig(sampleConditionTypes)
		const collapsible = advancedCollapsible(fields)
		expect(collapsible?.admin?.initCollapsed).toBe(true)
	})

	it('Advanced collapsible contains visibleWhen, validateWhen, and hidden', () => {
		const fields = sharedFieldConfig(sampleConditionTypes)
		const collapsible = advancedCollapsible(fields)
		const innerNames = collapsible?.fields.map((f) => ('name' in f ? f.name : f.type))
		expect(innerNames).toEqual(['visibleWhen', 'validateWhen', 'hidden'])
	})

	it('mounts FormConditionField on visibleWhen inside the collapsible', () => {
		const fields = sharedFieldConfig(sampleConditionTypes)
		const collapsible = advancedCollapsible(fields)
		const visibleWhen = collapsible?.fields.find((f) => 'name' in f && f.name === 'visibleWhen')
		expect(visibleWhen?.admin?.components?.Field).toMatchObject({
			path: '@10x-media/form-builder/client#FormConditionField',
			clientProps: { conditionTypes: sampleConditionTypes },
		})
	})

	it('mounts FormConditionField on validateWhen inside the collapsible', () => {
		const fields = sharedFieldConfig(sampleConditionTypes)
		const collapsible = advancedCollapsible(fields)
		const validateWhen = collapsible?.fields.find((f) => 'name' in f && f.name === 'validateWhen')
		expect(validateWhen?.admin?.components?.Field).toMatchObject({
			path: '@10x-media/form-builder/client#FormConditionField',
			clientProps: { conditionTypes: sampleConditionTypes },
		})
	})

	it('hidden is a checkbox inside the Advanced collapsible', () => {
		const fields = sharedFieldConfig(sampleConditionTypes)
		const collapsible = advancedCollapsible(fields)
		const hidden = collapsible?.fields.find((f) => 'name' in f && f.name === 'hidden')
		expect(hidden).toMatchObject({ name: 'hidden', type: 'checkbox' })
	})
})
