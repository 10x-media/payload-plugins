import type { GlobalConfig } from 'payload'

/**
 * A global with nested fields, for global-level and field-level guides.
 *
 * Its `sections` declares a `cta` block **inline**, while `config.blocks` holds
 * a registry block of the same slug with a different field set. That collision
 * is the fixture: the walker merges both under `block:cta`, so `label` is one
 * target in both places, `url` exists only here, `style` only on the registry
 * variant, and the plugin warns once on boot. See `dev/blocks/cta.ts`.
 */
export const settings: GlobalConfig = {
	slug: 'settings',
	fields: [
		{ name: 'siteName', type: 'text', localized: true },
		{
			name: 'socials',
			type: 'array',
			fields: [
				{ name: 'platform', type: 'text' },
				{ name: 'url', type: 'text' },
			],
		},
		{
			name: 'sections',
			type: 'blocks',
			blocks: [
				{
					slug: 'cta',
					labels: { singular: 'Inline call to action', plural: 'Inline calls to action' },
					fields: [
						{ name: 'label', type: 'text', localized: true },
						{ name: 'url', type: 'text' },
					],
				},
			],
		},
	],
}
