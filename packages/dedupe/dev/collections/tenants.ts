import type { CollectionConfig } from 'payload'

/** The offices of the dev stand; `@payloadcms/plugin-multi-tenant` scopes the rest by them. */
export const tenants: CollectionConfig = {
	slug: 'tenants',
	admin: { useAsTitle: 'name' },
	fields: [
		{ name: 'name', type: 'text', required: true },
		{ name: 'slug', type: 'text', required: true, unique: true },
	],
}
