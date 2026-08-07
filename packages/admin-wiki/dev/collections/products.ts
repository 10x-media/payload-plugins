import type { CollectionConfig } from 'payload'

/** A second, plain collection so collection-level guides are demonstrable. */
export const products: CollectionConfig = {
	slug: 'products',
	admin: { useAsTitle: 'name' },
	fields: [
		{ name: 'name', type: 'text', localized: true, required: true },
		{ name: 'price', type: 'number' },
		{ name: 'description', type: 'textarea', localized: true },
	],
}
