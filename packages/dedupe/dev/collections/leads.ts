import type { CollectionConfig } from 'payload'

/**
 * No trash and no match config: the manual merge with hard delete. Readers whose email
 * starts with `limited` may not read it, so the tests have a document to be refused on.
 */
export const leads: CollectionConfig = {
	slug: 'leads',
	admin: { useAsTitle: 'email' },
	access: {
		read: ({ req }) =>
			!String((req.user as { email?: string } | null)?.email ?? '').startsWith('limited'),
	},
	fields: [
		{ name: 'email', type: 'email' },
		{ name: 'source', type: 'text' },
	],
}
