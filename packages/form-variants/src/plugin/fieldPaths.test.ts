import type { Field } from 'payload'
import { describe, expect, it } from 'vitest'

import { collectDataPaths } from './fieldPaths'

const fields: Field[] = [
	{ name: 'title', type: 'text' },
	{
		type: 'row',
		fields: [
			{ name: 'a', type: 'text' },
			{ type: 'collapsible', label: 'More', fields: [{ name: 'b', type: 'text' }] },
		],
	},
	{
		name: 'address',
		type: 'group',
		fields: [{ name: 'city', type: 'text' }],
	},
	{
		type: 'group',
		label: 'Unnamed',
		fields: [{ name: 'flat', type: 'text' }],
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
	{
		name: 'content',
		type: 'blocks',
		blocks: [{ slug: 'hero', fields: [{ name: 'heading', type: 'text' }] }],
	},
]

describe('collectDataPaths', () => {
	const paths = collectDataPaths(fields)

	it('follows the data shape through unnamed containers', () => {
		expect(paths.has('title')).toBe(true)
		expect(paths.has('a')).toBe(true)
		expect(paths.has('b')).toBe(true)
		expect(paths.has('flat')).toBe(true)
		expect(paths.has('inTab')).toBe(true)
	})

	it('addresses named groups and tabs whole and field by field', () => {
		expect(paths.has('address')).toBe(true)
		expect(paths.has('address.city')).toBe(true)
		expect(paths.has('meta.seo')).toBe(true)
	})

	it('stops at arrays and blocks', () => {
		expect(paths.has('rows')).toBe(true)
		expect(paths.has('rows.inner')).toBe(false)
		expect(paths.has('content')).toBe(true)
		expect(paths.has('content.heading')).toBe(false)
	})

	it('does not list unnamed containers themselves', () => {
		expect([...paths.keys()].some((path) => path.includes('_index'))).toBe(false)
	})
})
