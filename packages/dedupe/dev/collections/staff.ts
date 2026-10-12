import type { CollectionConfig } from 'payload'

/**
 * A `tenant` field the multi-tenant plugin does not scope: here the branch a member answers
 * for. Left out of `multiTenancy.collections`, it is ordinary data to dedupe.
 */
export const staff: CollectionConfig = {
	slug: 'staff',
	labels: { singular: 'Staff member', plural: 'Staff' },
	admin: { useAsTitle: 'name', defaultColumns: ['name', 'email', 'tenant'] },
	fields: [
		{ name: 'name', type: 'text', required: true },
		{ name: 'email', type: 'email' },
		{ name: 'tenant', type: 'text', label: 'Branch' },
	],
}
