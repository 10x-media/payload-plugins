import type { CollectionConfig } from 'payload'

import { defineFormVariants } from '../../src/index'
import { isAdmin } from './users'

/**
 * Every variant, `native` included, is for admins only, so an editor opening a secret gets
 * the empty state instead of a form.
 */
export const secrets: CollectionConfig = {
	slug: 'secrets',
	admin: { useAsTitle: 'label' },
	custom: {
		formVariants: defineFormVariants('secrets', {
			defaultVariant: 'native',
			variants: [
				{
					key: 'quick',
					label: 'Quick form',
					access: ({ user }) => isAdmin(user),
					steps: [
						{
							key: 'secret',
							label: 'Secret',
							fields: [
								{
									type: 'field',
									path: 'label',
									admin: {
										width: '70%',
									},
								},
								'value',
							],
						},
					],
					// A centred reading column on the page, and the drawer's own width in a drawer,
					// which is narrow enough already.
					ui: { align: 'center', width: { page: 'half' } },
				},
				{ key: 'native', label: 'Full form', access: ({ user }) => isAdmin(user) },
			],
		}),
	},
	fields: [
		{ name: 'label', type: 'text', required: true },
		{ name: 'value', type: 'text', required: true },
		{ name: 'notes', type: 'textarea' },
	],
}
