import type { CollectionConfig } from 'payload'

/** Closed to readers whose email starts with `limited`, like `leads`, for the access tests. */
export const companies: CollectionConfig = {
	slug: 'companies',
	admin: { useAsTitle: 'name' },
	access: {
		read: ({ req }) =>
			!String((req.user as { email?: string } | null)?.email ?? '').startsWith('limited'),
	},
	fields: [{ name: 'name', type: 'text' }],
}
