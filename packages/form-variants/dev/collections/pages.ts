import type { CollectionConfig } from 'payload'

import { defineFormVariants } from '../../src/index'

/**
 * A localized collection, so the variants can be held against a locale switch. `slug` and
 * `audience` are shared by every locale; everything else is translated.
 *
 * The `legal` step exists to exercise the locale on the server: its condition reads `doc`,
 * which the evaluate endpoint loads in the locale being edited, so the step appears for the
 * locales whose intro mentions a price and stays away in the others. A condition reading
 * `values` would not prove anything, since those already come from the open locale.
 */
export const pages: CollectionConfig = {
	slug: 'pages',
	admin: { defaultColumns: ['title', 'slug', 'audience'], useAsTitle: 'title' },
	custom: {
		formVariants: defineFormVariants('pages', {
			defaultVariant: 'translate',
			variants: [
				{
					key: 'translate',
					label: 'Translate',
					navigation: 'free',
					save: 'always',
					ui: { align: 'center', width: { page: 'half' } },
					steps: [
						{
							key: 'basics',
							label: 'Basics',
							description: 'The slug is the same in every language; the title is not.',
							fields: [{ type: 'row', fields: ['title', 'slug'] }, 'audience'],
						},
						{
							key: 'body',
							label: 'Body',
							fields: ['intro', 'body'],
						},
						{
							key: 'seo',
							label: 'SEO',
							fields: ['seo.title', 'seo.description'],
						},
						{
							key: 'legal',
							label: 'Small print',
							description: 'Shown while the saved intro of this locale mentions a price.',
							condition: ({ doc }) =>
								typeof doc?.intro === 'string' && doc.intro.toLowerCase().includes('price'),
							fields: ['legalNote'],
						},
					],
				},
				{
					key: 'quick',
					label: 'Headline only',
					// One field, so Enter has nothing else to submit through.
					steps: [{ key: 'title', label: 'Headline', fields: ['title'] }],
				},
				{ key: 'native', label: 'Full form' },
			],
		}),
	},
	fields: [
		{ name: 'title', type: 'text', localized: true, required: true },
		{ name: 'slug', type: 'text', admin: { description: 'Shared by every language.' } },
		{
			name: 'audience',
			type: 'select',
			defaultValue: 'everyone',
			options: ['everyone', 'customers', 'partners'],
		},
		{ name: 'intro', type: 'textarea', localized: true },
		{ name: 'body', type: 'richText', localized: true },
		{ name: 'legalNote', type: 'textarea', localized: true },
		{
			name: 'seo',
			type: 'group',
			fields: [
				{ name: 'title', type: 'text', localized: true },
				{ name: 'description', type: 'textarea', localized: true },
			],
		},
	],
}
