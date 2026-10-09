import type { CollectionConfig } from 'payload'

/** Numbers matched three ways: the same SKU, a barcode off by a digit, a price within 5%. */
export const products: CollectionConfig = {
	slug: 'products',
	trash: true,
	admin: { useAsTitle: 'name', defaultColumns: ['name', 'sku', 'barcode', 'price'] },
	fields: [
		{ name: 'name', type: 'text', required: true },
		{ name: 'sku', type: 'number' },
		{ name: 'barcode', type: 'number' },
		{ name: 'price', type: 'number' },
	],
}
