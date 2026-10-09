import type { CollectionConfig } from 'payload'

/**
 * The offices of the dev stand; `@payloadcms/plugin-multi-tenant` scopes the rest by them. Each
 * has a language of its own, which a merge writes in.
 */
export const tenants: CollectionConfig = {
	slug: 'tenants',
	admin: { useAsTitle: 'name' },
	fields: [
		{ name: 'name', type: 'text', required: true },
		{ name: 'slug', type: 'text', required: true, unique: true },
		{ name: 'locale', type: 'select', options: ['en', 'de'], defaultValue: 'en' },
	],
}
