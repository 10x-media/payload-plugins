import type { Block } from 'payload'

/**
 * Reusable blocks for the dev collections. Each one exists to produce a
 * different form-state path shape, since the undo history keys everything by
 * path and the interesting bugs live in how paths nest.
 */

/** Scalars plus a named group: `layout.N.cta.label`. */
export const heroBlock: Block = {
	slug: 'hero',
	labels: { singular: 'Hero', plural: 'Heroes' },
	fields: [
		{ name: 'heading', type: 'text' },
		{ name: 'subheading', type: 'textarea' },
		{
			name: 'cta',
			type: 'group',
			fields: [
				{ name: 'label', type: 'text' },
				{ name: 'url', type: 'text' },
			],
		},
	],
}

/** Array inside a block: `layout.N.cards.M.link.label`. */
export const cardsBlock: Block = {
	slug: 'cards',
	fields: [
		{ name: 'intro', type: 'text' },
		{
			name: 'cards',
			type: 'array',
			fields: [
				{ name: 'title', type: 'text' },
				{
					name: 'link',
					type: 'group',
					fields: [
						{ name: 'label', type: 'text' },
						{ name: 'url', type: 'text' },
					],
				},
			],
		},
	],
}

/** Rich text inside a block: the Lexical restore path under a row index. */
export const richBlock: Block = {
	slug: 'richBlock',
	fields: [
		{ name: 'body', type: 'richText' },
		{ name: 'caption', type: 'text' },
	],
}

/** Tabs inside a block: named tab adds a segment, unnamed tab adds none. */
export const tabbedBlock: Block = {
	slug: 'tabbedBlock',
	fields: [
		{
			type: 'tabs',
			tabs: [
				{
					label: 'Content',
					fields: [
						{ name: 'blockTitle', type: 'text' },
						{ name: 'blockBody', type: 'textarea' },
					],
				},
				{
					name: 'settings',
					label: 'Settings',
					fields: [
						{ name: 'theme', type: 'select', options: ['light', 'dark'] },
						{ name: 'featured', type: 'checkbox' },
					],
				},
			],
		},
	],
}

/**
 * Blocks nested in blocks: `layout.N.inner.M.heading`. Reuses the leaf blocks
 * only, since a block cannot contain itself.
 */
export const nestedBlock: Block = {
	slug: 'nested',
	fields: [
		{ name: 'label', type: 'text' },
		{ name: 'inner', type: 'blocks', blocks: [heroBlock, cardsBlock] },
	],
}

export const allBlocks: Block[] = [heroBlock, cardsBlock, richBlock, tabbedBlock, nestedBlock]
