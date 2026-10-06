import type { FormVariantsConfig } from '../../src/index'

/** The articles variants, passed to the plugin options in `payload.config.ts`. */
export const articleVariants: FormVariantsConfig<'articles'> = {
	defaultVariant: 'compose',
	variants: [
		{
			key: 'compose',
			label: 'Compose',
			steps: [
				{
					key: 'basics',
					label: 'Basics',
					description: 'What readers see in listings.',
					fields: ['title', 'slug', 'excerpt'],
				},
				{ key: 'content', label: 'Content', fields: ['content'] },
				{
					key: 'settings',
					label: 'Settings',
					description: 'Publishing makes the article live straight away.',
					fields: ['category', 'publishedAt', 'author'],
				},
			],
		},
		{ key: 'native', label: 'Full form' },
	],
}
