import type { CollectionConfig } from 'payload'

/**
 * What a user belongs to, for the view extension showcase: `logs.extend` copies the
 * acting user's departments onto every entry, and the view renders and filters them.
 */
export const departments: CollectionConfig = {
	slug: 'departments',
	admin: { useAsTitle: 'name', group: 'Support' },
	fields: [{ name: 'name', type: 'text', required: true }],
}
