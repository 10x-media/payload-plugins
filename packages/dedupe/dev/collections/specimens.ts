import type { CollectionConfig } from 'payload'

/** Every kind of field Payload has, so the merge screen shows each one. */
export const specimens: CollectionConfig = {
	slug: 'specimens',
	trash: true,
	admin: { useAsTitle: 'title', defaultColumns: ['title', 'email', 'level', 'updatedAt'] },
	fields: [
		{ name: 'title', type: 'text', required: true },
		{ name: 'email', type: 'email', unique: true },
		{ name: 'bio', type: 'textarea' },
		{ name: 'age', type: 'number' },
		{ name: 'birthDate', type: 'date' },
		{ name: 'level', type: 'select', options: ['junior', 'middle', 'senior'] },
		{ name: 'skills', type: 'select', hasMany: true, options: ['ts', 'go', 'sql', 'css'] },
		{ name: 'contactBy', type: 'radio', options: ['email', 'phone', 'post'] },
		{ name: 'active', type: 'checkbox' },
		{ name: 'company', type: 'relationship', relationTo: 'companies' },
		{ name: 'friends', type: 'relationship', relationTo: 'customers', hasMany: true },
		{ name: 'about', type: 'relationship', relationTo: ['companies', 'customers'] },
		{ name: 'avatar', type: 'upload', relationTo: 'media' },
		{ name: 'notes', type: 'richText' },
		{ name: 'settings', type: 'json' },
		{ name: 'location', type: 'point' },
		{ name: 'snippet', type: 'code', admin: { language: 'ts' } },
		{ name: 'aliases', type: 'text', hasMany: true },
		{ name: 'scores', type: 'number', hasMany: true },
		{
			name: 'links',
			type: 'array',
			fields: [
				{ name: 'label', type: 'text' },
				{ name: 'url', type: 'text' },
				// A value per locale inside rows that are not localized themselves.
				{ name: 'caption', type: 'text', localized: true },
			],
		},
		// Rows that hold a relationship and rows of their own: an array in an array.
		{
			name: 'publications',
			type: 'array',
			fields: [
				{ name: 'title', type: 'text' },
				{ name: 'publisher', type: 'relationship', relationTo: 'companies' },
				{ name: 'year', type: 'number' },
				{
					name: 'editions',
					type: 'array',
					fields: [
						{ name: 'format', type: 'select', options: ['print', 'ebook', 'audio'] },
						{ name: 'isbn', type: 'text' },
					],
				},
			],
		},
		{
			name: 'layout',
			type: 'blocks',
			blocks: [
				{
					slug: 'hero',
					fields: [
						{ name: 'heading', type: 'text' },
						{ name: 'image', type: 'upload', relationTo: 'media' },
					],
				},
				{
					slug: 'quote',
					fields: [
						{ name: 'text', type: 'textarea' },
						{ name: 'author', type: 'text' },
					],
				},
				// Blocks in a block, one of them pointing at a document.
				{
					slug: 'section',
					fields: [
						{ name: 'heading', type: 'text' },
						{
							name: 'content',
							type: 'blocks',
							blocks: [
								{ slug: 'paragraph', fields: [{ name: 'text', type: 'textarea' }] },
								{
									slug: 'cta',
									fields: [
										{ name: 'label', type: 'text' },
										{ name: 'contact', type: 'relationship', relationTo: 'customers' },
									],
								},
							],
						},
					],
				},
			],
		},
		{
			name: 'address',
			type: 'group',
			fields: [
				{ name: 'city', type: 'text' },
				{ name: 'street', type: 'text' },
			],
		},
		{
			type: 'tabs',
			tabs: [{ name: 'social', label: 'Social', fields: [{ name: 'twitter', type: 'text' }] }],
		},
		{ name: 'motto', type: 'text', localized: true },
		{ name: 'summary', type: 'textarea', localized: true },
		{ name: 'secret', type: 'text', admin: { hidden: true } },
	],
}
