import type { CollectionConfig } from 'payload'

/**
 * Drafts are enabled here and nowhere else. The stand configures this collection
 * with `auditLog.drafts: 'ignore'`, so autosaved drafts stay out of the log and
 * publishing produces a single entry diffed against the last published version.
 */
export const pages: CollectionConfig = {
	slug: 'pages',
	admin: { useAsTitle: 'title', group: 'Audit logs' },
	versions: { drafts: true },
	fields: [
		{ name: 'title', type: 'text', required: true },
		{ name: 'slug', type: 'text' },
		{ name: 'body', type: 'textarea' },
	],
}
