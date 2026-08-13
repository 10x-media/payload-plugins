import type { CollectionConfig } from 'payload'

/**
 * One document that opens the list drawer from every direction the plugin claims to cover with a
 * single view swap: a plain upload, a hasMany upload, a polymorphic upload, single and hasMany
 * relationships, and a lexical upload node. The last two upload fields point at the control collections, so the same
 * document also shows what the plugin deliberately leaves untouched.
 */
export const posts: CollectionConfig = {
	slug: 'posts',
	admin: { useAsTitle: 'title' },
	fields: [
		{ name: 'title', type: 'text' },
		{ name: 'uploadSingle', type: 'upload', relationTo: 'media' },
		{ name: 'uploadMany', type: 'upload', relationTo: 'media', hasMany: true },
		{ name: 'uploadPolymorphic', type: 'upload', relationTo: ['media', 'files'] },
		{ name: 'uploadWithoutFolders', type: 'upload', relationTo: 'attachments' },
		{ name: 'uploadCurated', type: 'upload', relationTo: 'curated' },
		// `appearance: 'drawer'` is what makes a relationship open the list drawer at all; the
		// default 'select' never does, so without it this field would not exercise the plugin.
		{
			name: 'relationshipSingle',
			type: 'relationship',
			relationTo: 'media',
			admin: { appearance: 'drawer' },
		},
		// The drawer sets `enableRowSelections` from `hasMany`, and a relationship reaches that
		// through a different field than an upload does, so the multi-select path needs its own
		// field to be exercised at all.
		{
			name: 'relationshipMany',
			type: 'relationship',
			relationTo: 'media',
			hasMany: true,
			admin: { appearance: 'drawer' },
		},
		{ name: 'richText', type: 'richText' },
	],
}
