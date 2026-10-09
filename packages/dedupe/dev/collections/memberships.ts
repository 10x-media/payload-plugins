import type { CollectionConfig } from 'payload'

/** One membership per customer and club: a merge can make two collide. */
export const memberships: CollectionConfig = {
	slug: 'memberships',
	admin: { useAsTitle: 'title', defaultColumns: ['title', 'customer', 'club'] },
	indexes: [{ fields: ['customer', 'club'], unique: true }],
	fields: [
		{ name: 'title', type: 'text', required: true },
		{ name: 'customer', type: 'relationship', relationTo: 'customers', required: true },
		{ name: 'club', type: 'relationship', relationTo: 'companies', required: true },
	],
}
