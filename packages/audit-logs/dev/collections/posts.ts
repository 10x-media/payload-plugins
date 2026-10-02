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
 * - `summary` and `seo.description` are localized, so an edit in German is its own
 *   entry with a `de` locale badge
 * - the tabs nest paths the way a real schema does: the unnamed tab and its row add
 *   nothing (`layoutWidth`), the named tab and the groups inside it add a segment
 *   each (`distribution.social.image.alt`), the collapsible adds none
 *   (`distribution.publishAt`)
 */
export const posts: CollectionConfig = {
	slug: 'posts',
	admin: { useAsTitle: 'title', group: 'Audit logs' },
	fields: [
		{ name: 'title', type: 'text', required: true },
		{ name: 'summary', type: 'textarea', localized: true },
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
				{ name: 'description', type: 'textarea', localized: true },
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
		{
			type: 'tabs',
			tabs: [
				{
					label: 'Layout',
					fields: [
						{
							type: 'row',
							fields: [
								{ name: 'layoutWidth', type: 'select', options: ['narrow', 'wide'] },
								{ name: 'showToc', type: 'checkbox' },
							],
						},
					],
				},
				{
					name: 'distribution',
					label: 'Distribution',
					fields: [
						{ name: 'channel', type: 'select', options: ['web', 'newsletter', 'social'] },
						{
							name: 'social',
							type: 'group',
							fields: [
								{ name: 'headline', type: 'text' },
								{
									name: 'image',
									type: 'group',
									fields: [
										{ name: 'alt', type: 'text' },
										{ name: 'credit', type: 'text' },
									],
								},
							],
						},
						{
							type: 'collapsible',
							label: 'Scheduling',
							fields: [{ name: 'publishAt', type: 'date' }],
						},
					],
				},
			],
		},
	],
}
