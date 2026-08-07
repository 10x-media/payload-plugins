import type { CollectionConfig } from 'payload'

export const users: CollectionConfig = {
	slug: 'users',
	auth: true,
	admin: { useAsTitle: 'email', group: 'Support' },
	fields: [],
}
