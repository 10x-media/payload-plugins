import type { CollectionConfig } from 'payload'

/**
 * The other half of the drafts comparison. Same shape as `pages`, but the stand
 * configures it with `auditLog.drafts: 'log'`, so every draft save is an entry.
 *
 * Autosave is on with a short interval on purpose: type a few words, wait, and the
 * difference between the two collections shows up in the log without saving by hand.
 */
export const articles: CollectionConfig = {
	slug: 'articles',
	admin: { useAsTitle: 'title', group: 'Audit logs' },
	versions: { drafts: { autosave: { interval: 2000 } } },
	fields: [
		{ name: 'title', type: 'text', required: true },
		{ name: 'slug', type: 'text' },
		{ name: 'body', type: 'textarea' },
	],
}
