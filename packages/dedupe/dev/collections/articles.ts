import type { CollectionConfig } from 'payload'

/** Drafts on: the merge of the published state has to notice a draft newer than it. */
export const articles: CollectionConfig = {
	slug: 'articles',
	trash: true,
	versions: { drafts: true },
	admin: { useAsTitle: 'title' },
	fields: [
		{ name: 'title', type: 'text' },
		{ name: 'summary', type: 'textarea' },
		// A localized field gives Publish its "Publish in <locale>" option.
		{ name: 'tagline', type: 'text', localized: true },
	],
}
