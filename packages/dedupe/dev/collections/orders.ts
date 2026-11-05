import type { CollectionConfig } from 'payload'

/**
 * Documents pointing at customers, one of each shape a reference can take, for the repoint
 * that moves them to the surviving customer on a merge.
 */
export const orders: CollectionConfig = {
	slug: 'orders',
	admin: { useAsTitle: 'number', defaultColumns: ['number', 'customer', 'tenant'] },
	fields: [
		{ name: 'number', type: 'text', required: true },
		{ name: 'customer', type: 'relationship', relationTo: 'customers' },
		{
			name: 'items',
			type: 'array',
			fields: [
				{ name: 'product', type: 'text' },
				{ name: 'handledBy', type: 'relationship', relationTo: 'customers' },
			],
		},
		{ name: 'reviewedBy', type: 'relationship', relationTo: 'customers', localized: true },
	],
}
