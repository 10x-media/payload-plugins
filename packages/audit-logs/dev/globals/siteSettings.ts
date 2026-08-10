import type { GlobalConfig } from 'payload'

/**
 * Globals take a different hook path than collections (`afterChange` only, no
 * create or delete), and their log entries are stored with the `__global__`
 * sentinel in `relationTo` and the global slug in `documentId`. The stand needs
 * one to exercise that branch.
 */
export const siteSettings: GlobalConfig = {
	slug: 'site-settings',
	label: 'Site settings',
	admin: { group: 'Audit logs' },
	fields: [
		{ name: 'siteName', type: 'text' },
		{ name: 'tagline', type: 'text' },
		{
			name: 'contact',
			type: 'group',
			fields: [
				{ name: 'email', type: 'email' },
				{ name: 'phone', type: 'text' },
			],
		},
		{
			name: 'nav',
			type: 'array',
			fields: [
				{ name: 'label', type: 'text' },
				{ name: 'url', type: 'text' },
			],
		},
	],
}
