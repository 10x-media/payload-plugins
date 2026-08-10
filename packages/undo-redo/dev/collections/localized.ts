import type { CollectionConfig } from 'payload'

import { heroBlock } from './blocks'

/**
 * Locale coverage. The form only ever holds the active locale's values, so the
 * paths are identical across locales and undo must not carry a value from one
 * locale into another. The non-localized fields sitting next to the localized
 * ones are the control group: switching locale must leave them alone, and
 * undoing in one locale must not revert them either.
 */
export const localized: CollectionConfig = {
	slug: 'localized-docs',
	labels: { singular: 'Localized doc', plural: 'Localized docs' },
	admin: { useAsTitle: 'title', group: 'Undo/redo' },
	fields: [
		{ name: 'title', type: 'text', localized: true },
		{
			name: 'shared',
			type: 'text',
			admin: { description: 'not localized: one value for all locales' },
		},
		{ name: 'content', type: 'richText', localized: true },
		{
			name: 'localizedItems',
			type: 'array',
			localized: true,
			admin: { description: 'the whole array is per locale, including row count and order' },
			fields: [
				{ name: 'label', type: 'text' },
				{ name: 'note', type: 'textarea' },
			],
		},
		{
			name: 'sharedItems',
			type: 'array',
			admin: { description: 'shared rows, per-locale leaf values' },
			fields: [
				{ name: 'sku', type: 'text' },
				{ name: 'label', type: 'text', localized: true },
			],
		},
		{
			name: 'meta',
			type: 'group',
			fields: [
				{ name: 'headline', type: 'text', localized: true },
				{ name: 'internalId', type: 'text' },
			],
		},
		{
			name: 'sections',
			type: 'blocks',
			localized: true,
			blocks: [heroBlock],
		},
	],
}
