import type { CollectionConfig } from 'payload'

/**
 * The only auth collection in the stand, so `user` on an audit log entry stores a
 * plain id rather than a polymorphic `{ relationTo, value }` pair. Adding a second
 * auth collection here is the way to exercise the polymorphic branch by hand.
 */
export const users: CollectionConfig = {
	slug: 'users',
	auth: true,
	admin: { useAsTitle: 'email', group: 'Support' },
	fields: [{ name: 'name', type: 'text' }],
}
