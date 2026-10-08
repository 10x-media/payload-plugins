import type { CollectionConfig } from 'payload'

/**
 * A second auth collection. With two of them the plugin stores `user` and
 * `impersonator` as polymorphic `{ relationTo, value }` pairs, so the stand
 * exercises that branch of the view: pills, links and the user filter.
 *
 * Customers never reach the admin panel (`admin.user` is `users`). Their entries
 * come from the seed, which writes orders and custom events as one of them.
 */
export const customers: CollectionConfig = {
	slug: 'customers',
	auth: true,
	admin: { useAsTitle: 'email', group: 'Support' },
	fields: [{ name: 'name', type: 'text' }],
}
