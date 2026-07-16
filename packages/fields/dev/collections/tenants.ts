import type { CollectionConfig } from 'payload'
import { colorField } from '../../src/exports/color'

export const tenants: CollectionConfig = {
	slug: 'tenants',
	admin: { useAsTitle: 'name' },
	fields: [
		{ name: 'name', type: 'text', required: true },
		{
			name: 'brandColors',
			type: 'array',
			fields: [
				{ name: 'key', type: 'text', required: true },
				{ name: 'label', type: 'text' },
				colorField({ name: 'value', required: true }),
			],
		},
	],
}
