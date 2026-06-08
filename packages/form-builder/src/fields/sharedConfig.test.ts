import type { Field } from 'payload'
import { describe, expect, it } from 'vitest'
import { sharedFieldConfig } from './sharedConfig'

const nameOf = (field: Field) => ('name' in field ? field.name : undefined)

const sampleConditionTypes = { text: 'text', number: 'number' } as const

describe('sharedFieldConfig', () => {
	it('lists the standard per-field config in order', () => {
		const fields = sharedFieldConfig(sampleConditionTypes)
		expect(fields.map(nameOf)).toEqual([
			'name',
			'label',
			'required',
			'width',
			'placeholder',
			'description',
			'visibleWhen',
			'validateWhen',
		])
	})

	it('makes name required', () => {
		const name = sharedFieldConfig(sampleConditionTypes).find(
			(field) => 'name' in field && field.name === 'name'
		)
		expect(name && 'required' in name && name.required).toBe(true)
	})

	it('mounts FormConditionField on visibleWhen', () => {
		const fields = sharedFieldConfig(sampleConditionTypes)
		const visibleWhen = fields.find((f) => 'name' in f && f.name === 'visibleWhen')
		expect(visibleWhen?.admin?.components?.Field).toMatchObject({
			path: '@10x-media/form-builder/client#FormConditionField',
			clientProps: { conditionTypes: sampleConditionTypes },
		})
	})

	it('mounts FormConditionField on validateWhen', () => {
		const fields = sharedFieldConfig(sampleConditionTypes)
		const validateWhen = fields.find((f) => 'name' in f && f.name === 'validateWhen')
		expect(validateWhen?.admin?.components?.Field).toMatchObject({
			path: '@10x-media/form-builder/client#FormConditionField',
			clientProps: { conditionTypes: sampleConditionTypes },
		})
	})
})
