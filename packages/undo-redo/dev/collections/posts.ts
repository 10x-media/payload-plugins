import type { CollectionConfig } from 'payload'

import { undoRedoCustom } from '../../src/schema/fieldConfig'
import { allBlocks } from './blocks'

/**
 * Field-type coverage for undo/redo, grouped into tabs so a reviewer can work
 * one category at a time. The tab mix is deliberate: unnamed tabs leave their
 * children at the document root (`title`), a named tab prefixes them
 * (`seo.title`), and both spellings of `title` coexist to prove the history
 * keys by full path rather than field name.
 */
export const posts: CollectionConfig = {
	slug: 'posts',
	admin: { useAsTitle: 'title', group: 'Undo/redo' },
	fields: [
		{
			type: 'tabs',
			tabs: [
				{
					label: 'Scalars',
					description: 'One of every primitive editor, all at the document root.',
					fields: [
						{ name: 'title', type: 'text' },
						{ name: 'summary', type: 'textarea' },
						{ name: 'views', type: 'number' },
						{ name: 'rating', type: 'number', min: 0, max: 5 },
						{ name: 'published', type: 'checkbox' },
						{
							name: 'status',
							type: 'select',
							options: ['draft', 'review', 'published'],
						},
						{
							name: 'audiences',
							type: 'select',
							hasMany: true,
							options: ['dev', 'design', 'sales', 'support'],
						},
						{
							name: 'flavor',
							type: 'radio',
							options: ['sweet', 'salty', 'sour'],
						},
						{ name: 'publishAt', type: 'date' },
						{
							name: 'publishAtWithTime',
							type: 'date',
							admin: { date: { pickerAppearance: 'dayAndTime' } },
						},
						{ name: 'contact', type: 'email' },
						{ name: 'snippet', type: 'code', admin: { language: 'ts' } },
						{ name: 'metadata', type: 'json' },
						{ name: 'location', type: 'point' },
					],
				},
				{
					name: 'seo',
					label: 'SEO (named tab)',
					description: 'Paths here are prefixed with `seo.`, unlike the Scalars tab.',
					fields: [
						{ name: 'title', type: 'text' },
						{ name: 'description', type: 'textarea' },
						{ name: 'noIndex', type: 'checkbox' },
						{
							name: 'keywords',
							type: 'array',
							fields: [{ name: 'word', type: 'text' }],
						},
					],
				},
				{
					label: 'Relations',
					fields: [
						{ name: 'primaryTag', type: 'relationship', relationTo: 'tags' },
						{ name: 'relatedTags', type: 'relationship', relationTo: 'tags', hasMany: true },
						{
							name: 'mixed',
							type: 'relationship',
							relationTo: ['tags', 'posts'],
							hasMany: true,
						},
					],
				},
				{
					label: 'Rich text',
					description: 'Lexical owns its own undo. The plugin must not double-apply.',
					fields: [
						{ name: 'content', type: 'richText' },
						{
							name: 'notes',
							type: 'richText',
							admin: {
								custom: undoRedoCustom({ disabled: true }),
								description: 'Opted out per field: edits here never appear in the history overlay.',
							},
						},
						{ name: 'plainNextToRich', type: 'text' },
					],
				},
				{
					label: 'Blocks',
					fields: [{ name: 'layout', type: 'blocks', blocks: allBlocks }],
				},
				{
					label: 'Conditions',
					description:
						'Conditions are evaluated on the server and shipped as `passesCondition`, and a failing condition stops the walk into a field, so the paths below it leave form state entirely. Undo has to bring back the visibility, the value, and the subtree together.',
					fields: [
						{ name: 'hasPromo', type: 'checkbox' },
						{
							name: 'promoCode',
							type: 'text',
							admin: { condition: (data) => Boolean(data?.hasPromo) },
						},
						{
							name: 'promoDetails',
							type: 'group',
							admin: {
								condition: (data) => Boolean(data?.hasPromo),
								description:
									'A hidden container: its children disappear from form state, not just from view.',
							},
							fields: [
								{ name: 'note', type: 'text' },
								{
									name: 'tiers',
									type: 'array',
									fields: [{ name: 'label', type: 'text' }],
								},
							],
						},
						{
							name: 'conditionalRows',
							type: 'array',
							admin: {
								description: 'Per-row conditions, keyed off sibling data rather than the document.',
							},
							fields: [
								{
									name: 'mode',
									type: 'select',
									options: ['simple', 'detailed'],
									defaultValue: 'simple',
								},
								{
									name: 'detail',
									type: 'text',
									admin: { condition: (_data, siblingData) => siblingData?.mode === 'detailed' },
								},
							],
						},
					],
				},
			],
		},
	],
}
