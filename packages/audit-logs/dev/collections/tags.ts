import type { CollectionConfig } from 'payload'

/**
 * Relationship target for `posts`. Audited itself so that reordering a post's tags
 * and renaming a tag show up as two separate entries in the log.
 */
export const tags: CollectionConfig = {
	slug: 'tags',
	admin: { useAsTitle: 'name', group: 'Audit logs' },
	fields: [
		{ name: 'name', type: 'text', required: true },
		{ name: 'color', type: 'text' },
	],
}
