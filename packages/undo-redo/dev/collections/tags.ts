import type { CollectionConfig } from 'payload'

/** Relationship target, kept trivial so relationship undo has stable options. */
export const tags: CollectionConfig = {
	slug: 'tags',
	admin: { useAsTitle: 'name', group: 'Support' },
	fields: [
		{ name: 'name', type: 'text' },
		{ name: 'color', type: 'text' },
	],
}
