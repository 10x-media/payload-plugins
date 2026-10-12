import type { GlobalConfig } from 'payload'

/** A global that points at a customer, so a merge moves a reference held outside any collection. */
export const site: GlobalConfig = {
	slug: 'site',
	fields: [{ name: 'featuredCustomer', type: 'relationship', relationTo: 'customers' }],
}
