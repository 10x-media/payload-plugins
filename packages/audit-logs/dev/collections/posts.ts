import type { CollectionConfig } from 'payload'

/**
 * The main audited collection. The field mix is chosen so that every branch of the
 * diff engine is reachable by hand in the admin panel:
 *
 * - scalars produce plain `before`/`after` pairs
 * - `tags` is a relationship, so the diff must store ids rather than populated docs
 * - `sections` is an array with row ids, so reordering rows produces `sections.__order__`
 * - `seo` is a group, so paths arrive dot-notated (`seo.title`)
 * - `internalNotes` is excluded per collection, so edits to it never reach the log
 * - `apiKey` is anonymized, so its path is recorded but its value is redacted
 */
export const posts: CollectionConfig = {
	slug: 'posts',
	admin: { useAsTitle: 'title', group: 'Audit logs' },
	fields: [
		{ name: 'title', type: 'text', required: true },
		{ name: 'summary', type: 'textarea' },
		{ name: 'views', type: 'number' },
		{ name: 'published', type: 'checkbox' },
		{ name: 'status', type: 'select', options: ['draft', 'review', 'published'] },
		{ name: 'tags', type: 'relationship', relationTo: 'tags', hasMany: true },
		{ name: 'author', type: 'relationship', relationTo: 'users' },
		{
			name: 'seo',
			type: 'group',
			fields: [
				{ name: 'title', type: 'text' },
				{ name: 'description', type: 'textarea' },
			],
		},
		{
			name: 'sections',
			type: 'array',
			fields: [
				{ name: 'heading', type: 'text' },
				{ name: 'body', type: 'textarea' },
			],
		},
		{ name: 'internalNotes', type: 'textarea', admin: { description: 'Excluded from the log.' } },
		{ name: 'apiKey', type: 'text', admin: { description: 'Redacted in the log.' } },
	],
}
