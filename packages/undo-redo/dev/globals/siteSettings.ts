import type { GlobalConfig } from 'payload'

import { heroBlock } from '../collections/blocks'

/**
 * Globals mount the controls through a different slot than collections
 * (`admin.components.elements` rather than `admin.components.edit`), so the
 * dev app needs one to exercise that branch of the plugin.
 */
export const siteSettings: GlobalConfig = {
	slug: 'site-settings',
	label: 'Site settings',
	admin: { group: 'Undo/redo' },
	fields: [
		{ name: 'siteName', type: 'text' },
		{ name: 'tagline', type: 'text', localized: true },
		{
			name: 'nav',
			type: 'array',
			fields: [
				{ name: 'label', type: 'text' },
				{ name: 'url', type: 'text' },
				{
					name: 'children',
					type: 'array',
					fields: [
						{ name: 'label', type: 'text' },
						{ name: 'url', type: 'text' },
					],
				},
			],
		},
		{
			name: 'contact',
			type: 'group',
			fields: [
				{ name: 'email', type: 'email' },
				{ name: 'phone', type: 'text' },
			],
		},
		{ name: 'promo', type: 'blocks', blocks: [heroBlock] },
	],
}
