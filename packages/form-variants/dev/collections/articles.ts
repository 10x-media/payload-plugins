import type { CollectionConfig } from 'payload'

/**
 * Drafts with autosave, configured in the plugin options rather than on the collection (see
 * `variants/articles.ts`), as a collection owned by another plugin would be. Payload creates
 * the draft as soon as `/create` opens, so the variant runs as an update from the start.
 */
export const articles: CollectionConfig = {
	slug: 'articles',
	admin: { defaultColumns: ['title', 'category', '_status'], useAsTitle: 'title' },
	versions: { drafts: { autosave: true } },
	fields: [
		{ name: 'title', type: 'text', required: true },
		{ name: 'slug', type: 'text', admin: { description: 'Used in the URL.' } },
		{ name: 'excerpt', type: 'textarea' },
		{ name: 'content', type: 'richText' },
		{
			type: 'row',
			fields: [
				{ name: 'category', type: 'select', options: ['news', 'guide', 'opinion'] },
				{ name: 'publishedAt', type: 'date' },
			],
		},
		{ name: 'author', type: 'relationship', relationTo: 'users' },
		{ name: 'featured', type: 'checkbox', admin: { position: 'sidebar' } },
	],
}
