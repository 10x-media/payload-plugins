import type { CollectionConfig } from 'payload'

export const trips: CollectionConfig = {
	slug: 'trips',
	admin: { useAsTitle: 'title' },
	fields: [
		{ name: 'title', type: 'text', required: true },
		{ name: 'participants', type: 'relationship', relationTo: 'customers', hasMany: true },
	],
}
