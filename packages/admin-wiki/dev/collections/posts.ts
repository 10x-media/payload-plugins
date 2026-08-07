import { colorField } from '@10x-media/fields/color'
import { iconField } from '@10x-media/fields/icon'
import type { CollectionConfig } from 'payload'

/**
 * The kitchen-sink collection for wiki targeting: nested tabs, a group, layout
 * blocks, and `@10x-media/fields` fields proving the third-party integration
 * contract (their Description slot surfaces the field help unchanged).
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
							blocks: [
								{
									slug: 'heroBanner',
									fields: [
										{ name: 'heading', type: 'text', localized: true },
										colorField({ name: 'background' }),
									],
								},
								{
									slug: 'cta',
									fields: [
										{ name: 'label', type: 'text', localized: true },
										{ name: 'url', type: 'text' },
									],
								},
							],
						},
					],
				},
				{
					name: 'meta',
					label: 'Meta',
					fields: [{ name: 'seoTitle', type: 'text', localized: true }],
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
			],
		},
	],
}
