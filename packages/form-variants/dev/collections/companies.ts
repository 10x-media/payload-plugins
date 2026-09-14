import type { CollectionConfig } from 'payload'

import { defineFormVariants } from '../../src/index'
import { isAdmin } from './users'

/**
 * A one-step variant: no progress, no "Step 1 of 1", Save in the footer. Its `contacts` field
 * is also the drawer case: creating a person from it opens the people edit view in a drawer,
 * where the people variants apply.
 */
export const companies: CollectionConfig = {
	slug: 'companies',
	admin: { useAsTitle: 'name' },
	custom: {
		formVariants: defineFormVariants('companies', {
			defaultVariant: 'simple',
			variants: [
				{
					key: 'simple',
					label: 'Simple form',
					steps: [
						{
							key: 'company',
							label: 'Company',
							description: 'The name and the people to contact there.',
							fields: ['name', 'contacts'],
						},
					],
				},
				{ key: 'native', label: 'Full form', access: ({ user }) => isAdmin(user) },
			],
		}),
	},
	fields: [
		{ name: 'name', type: 'text', required: true },
		{ name: 'contacts', type: 'relationship', hasMany: true, relationTo: 'people' },
		{ name: 'website', type: 'text' },
		{
			name: 'industry',
			type: 'select',
			options: ['software', 'manufacturing', 'retail', 'services'],
		},
		{ name: 'notes', type: 'textarea' },
	],
}
