import type { GlobalConfig } from 'payload'

/** A global with nested fields, for global-level and field-level guides. */
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
	],
}
