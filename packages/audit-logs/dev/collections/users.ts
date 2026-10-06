import type { CollectionConfig } from 'payload'

/** Admin users. `customers` is the second auth collection, see there. */
export const users: CollectionConfig = {
	slug: 'users',
	auth: true,
	admin: { useAsTitle: 'email', group: 'Support' },
	fields: [{ name: 'name', type: 'text' }],
}
