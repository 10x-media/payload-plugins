import type { CollectionConfig } from 'payload'

/** A polymorphic reference, and drafts: a note with unpublished changes blocks a merge. */
export const notes: CollectionConfig = {
	slug: 'notes',
	admin: { useAsTitle: 'text' },
	versions: { drafts: true },
	fields: [
		{ name: 'text', type: 'text', required: true },
		{ name: 'about', type: 'relationship', relationTo: ['customers', 'companies'] },
	],
}
