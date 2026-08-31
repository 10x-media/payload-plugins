import type { CollectionConfig } from 'payload'

/**
 * Hook interaction, the part that is easy to get wrong and impossible to see from the
 * log alone. Every hook here mutates something the audit entry then has to reflect.
 *
 * - `beforeValidate` normalizes the reference to upper case
 * - `beforeChange` derives `total` from the lines, so the stored value is never what was
 *   submitted
 * - `beforeChange` also sets `lastTouchedBy`, proving a host hook wins over the plugin's
 *   own audit-field hook, which is registered first on purpose
 * - `afterChange` writes to `order-events`, which is audited too, so one save produces
 *   two entries
 */
export const orders: CollectionConfig = {
	slug: 'orders',
	admin: { useAsTitle: 'reference', group: 'Audit logs' },
	fields: [
		{ name: 'reference', type: 'text', required: true },
		{ name: 'status', type: 'select', options: ['open', 'paid', 'shipped'], defaultValue: 'open' },
		{
			name: 'lines',
			type: 'array',
			fields: [
				{ name: 'sku', type: 'text' },
				{ name: 'price', type: 'number' },
			],
		},
		{ name: 'total', type: 'number', admin: { readOnly: true } },
		{ name: 'lastTouchedBy', type: 'relationship', relationTo: 'users' },
	],
	hooks: {
		beforeValidate: [
			({ data }) => {
				if (typeof data?.reference === 'string') data.reference = data.reference.toUpperCase()
				return data
			},
		],
		beforeChange: [
			({ data, req }) => {
				const lines = Array.isArray(data.lines) ? (data.lines as { price?: number }[]) : []
				data.total = lines.reduce((sum, line) => sum + (line.price ?? 0), 0)
				if (req.user) data.lastTouchedBy = req.user.id
				return data
			},
		],
		afterChange: [
			async ({ doc, operation, req }) => {
				await req.payload.create({
					collection: 'order-events',
					data: { order: doc.id, kind: operation === 'create' ? 'opened' : 'changed' },
					req,
				})
				return doc
			},
		],
	},
}

/** Written to by the `orders` afterChange hook, and audited, so the cascade is visible. */
export const orderEvents: CollectionConfig = {
	slug: 'order-events',
	admin: { useAsTitle: 'kind', group: 'Audit logs' },
	fields: [
		{ name: 'order', type: 'relationship', relationTo: 'orders' },
		{ name: 'kind', type: 'text' },
	],
}
