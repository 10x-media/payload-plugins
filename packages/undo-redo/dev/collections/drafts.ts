import type { CollectionConfig } from 'payload'

/**
 * Autosaving draft collection. Autosave is the hostile case for a form-state
 * history: the server answers each autosave with a merged form state, and that
 * echo must not land in the stack as a phantom entry, nor overwrite a value the
 * user just restored. The interval is deliberately shorter than a comfortable
 * typing pause so the race is easy to reproduce by hand.
 */
export const drafts: CollectionConfig = {
	slug: 'drafts',
	admin: { useAsTitle: 'title', group: 'Undo/redo' },
	versions: { drafts: { autosave: { interval: 800 } }, maxPerDoc: 10 },
	fields: [
		{ name: 'title', type: 'text' },
		{ name: 'body', type: 'richText' },
		{
			name: 'items',
			type: 'array',
			fields: [{ name: 'value', type: 'text' }],
		},
	],
}
