import type { ClientField } from 'payload'
import { describe, expect, it } from 'vitest'

import { buildFieldIndex } from './fieldIndex'

const fields = [
	{ name: 'title', type: 'text' },
	{
		type: 'row',
		fields: [{ name: 'inRow', type: 'text' }],
	},
	{
		name: 'address',
		type: 'group',
		fields: [{ name: 'city', type: 'text' }],
	},
	{
		type: 'tabs',
		tabs: [
			{ label: 'Plain', fields: [{ name: 'inTab', type: 'text' }] },
			{ name: 'meta', label: 'Meta', fields: [{ name: 'seo', type: 'text' }] },
		],
	},
	{
		name: 'rows',
		type: 'array',
		fields: [{ name: 'inner', type: 'text' }],
	},
] as unknown as ClientField[]

describe('buildFieldIndex', () => {
	const index = buildFieldIndex(fields, 'people', {
		address: { create: true, fields: { city: true }, read: true, update: true },
		title: true,
	})

	it('addresses top-level fields from the root level', () => {
		expect(index.get('title')).toMatchObject({
			parentIndexPath: '',
			parentPath: '',
			parentSchemaPath: 'people',
		})
	})

	it('passes an unnamed row through with its index path and the same schema path', () => {
		expect(index.get('inRow')).toMatchObject({
			parentIndexPath: '1',
			parentPath: '',
			parentSchemaPath: 'people',
		})
	})

	it('nests a named group with the group permissions below it', () => {
		expect(index.get('address.city')).toMatchObject({
			parentIndexPath: '',
			parentPath: 'address',
			parentSchemaPath: 'people.address',
			permissions: { city: true },
		})
	})

	it('mirrors how Payload paths tab children', () => {
		expect(index.get('inTab')).toMatchObject({
			parentPath: '_index-3-0',
			parentSchemaPath: 'people._index-3-0',
		})
		expect(index.get('meta.seo')).toMatchObject({
			parentPath: 'meta',
			parentSchemaPath: 'people._index-3.meta',
		})
	})

	it('stops at arrays', () => {
		expect(index.has('rows')).toBe(true)
		expect(index.has('rows.inner')).toBe(false)
	})
})
