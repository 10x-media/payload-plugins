import type { CollectionConfig } from 'payload'

/**
 * One half of the drafts comparison, against `articles`. This one runs on the default
 * `auditLog.drafts: 'ignore'`, so draft saves stay out of the log and publishing produces
 * a single entry diffed against the last published version.
 *
 * Autosave matches `articles` so the two are compared on equal terms.
 */
export const pages: CollectionConfig = {
	slug: 'pages',
	admin: { useAsTitle: 'title', group: 'Audit logs' },
	versions: { drafts: { autosave: { interval: 2000 } } },
	fields: [
		{ name: 'title', type: 'text', required: true },
		{ name: 'slug', type: 'text' },
		{ name: 'body', type: 'textarea' },
	],
}
