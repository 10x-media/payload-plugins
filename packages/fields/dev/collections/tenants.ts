import type { CollectionConfig } from 'payload'
import { colorField } from '../../src/exports/color'
import { iconLibraryField } from '../../src/exports/icon'

export const tenants: CollectionConfig = {
	slug: 'tenants',
	admin: { useAsTitle: 'name' },
	fields: [
		{ name: 'name', type: 'text', required: true },
		iconLibraryField({ hasMany: true, name: 'enabledLibraries' }),
		colorField({ name: 'primary', label: { de: 'Primär', en: 'Primary' } }),
		colorField({ name: 'accent', label: { de: 'Akzent', en: 'Accent' } }),
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
