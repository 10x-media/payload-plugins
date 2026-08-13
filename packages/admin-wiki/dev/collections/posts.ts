import { colorField } from '@10x-media/fields/color'
import { iconField } from '@10x-media/fields/icon'
import type { CollectionConfig } from 'payload'

/**
 * The kitchen-sink collection for wiki targeting: nested tabs, a group, a layout
 * referencing the shared `heroBanner` block, and `@10x-media/fields` fields
 * proving the third-party integration contract (their Description slot surfaces
 * the field help unchanged).
 *
 * `specs` is the field picker's fixture: an array holding a second array, one of
 * them behind a named group, so the drawer's prefill has to build
 * `{ specs: [{ values: [{}] }] }` before anything inside is clickable.
 */
export const posts: CollectionConfig = {
	slug: 'posts',
	admin: { useAsTitle: 'title' },
	fields: [
		{ name: 'title', type: 'text', localized: true, required: true },
		{
			type: 'tabs',
			tabs: [
				{
					label: 'Content',
					fields: [
						{
							name: 'intro',
							type: 'textarea',
							admin: { description: 'Shown above the fold.' },
							localized: true,
						},
						{
							name: 'layout',
							type: 'blocks',
							blockReferences: ['heroBanner'],
							blocks: [],
						},
					],
				},
				{
					name: 'meta',
					label: 'Meta',
					fields: [{ name: 'seoTitle', type: 'text', localized: true }],
				},
				{
					name: 'Localized',
					fields: [
						{
							name: 'objectDescription',
							type: 'text',
							admin: {
								description: {
									en: 'This is the object description in English',
									de: 'This is the object description in German',
								},
							},
						},
						{
							name: 'functionDescription',
							type: 'text',
							admin: {
								description: ({ i18n }) => `This is function description in ${i18n.language}`,
							},
						},
					],
				},
			],
		},
		{
			name: 'specs',
			type: 'array',
			fields: [
				{ name: 'label', type: 'text' },
				{
					name: 'values',
					type: 'array',
					fields: [
						{ name: 'value', type: 'text' },
						{ name: 'unit', type: 'text' },
					],
				},
			],
		},
		{
			name: 'branding',
			type: 'group',
			fields: [
				colorField({ name: 'accent' }),
				iconField({ name: 'icon' }),
				{ name: 'tagline', type: 'text', localized: true },
				{
					name: 'links',
					type: 'array',
					fields: [
						{ name: 'label', type: 'text' },
						{ name: 'href', type: 'text' },
					],
				},
			],
		},
	],
}
