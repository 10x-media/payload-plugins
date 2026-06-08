import type { Field } from 'payload'
import { describe, expect, it } from 'vitest'
import { sharedFieldConfig } from './sharedConfig'

const nameOf = (field: Field) => ('name' in field ? field.name : undefined)

describe('sharedFieldConfig', () => {
	it('lists the standard per-field config in order', () => {
		const fields = sharedFieldConfig()
		expect(fields.map(nameOf)).toEqual([
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
})
