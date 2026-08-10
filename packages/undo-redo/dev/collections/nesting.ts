import type { CollectionConfig } from 'payload'

import { cardsBlock, heroBlock, richBlock, tabbedBlock } from './blocks'

/**
 * Structural coverage: every container that changes how a field's form-state
 * path is built, and every combination where one container sits inside another.
 *
 * The path shape each field produces is called out in its description, because
 * the whole point of this collection is to check that undo restores the right
 * path and only that path. The pairs that matter most:
 *
 * - unnamed group / row / collapsible add no path segment, so their children
 *   land at the document root next to unrelated fields
 * - a named group adds one segment, and nests
 * - array and blocks rows add an index segment plus a row id the history tracks
 *   separately from values, which is what makes reorder distinguishable from
 *   edit
 */
export const nesting: CollectionConfig = {
	slug: 'nesting',
	admin: { useAsTitle: 'label', group: 'Undo/redo' },
	fields: [
		{ name: 'label', type: 'text' },

		{
			type: 'collapsible',
			label: 'Unnamed containers (children stay at the root)',
			admin: { initCollapsed: false },
			fields: [
				{
					type: 'group',
					label: 'Unnamed group',
					fields: [
						{ name: 'looseAlpha', type: 'text', admin: { description: 'path: looseAlpha' } },
						{ name: 'looseBeta', type: 'text', admin: { description: 'path: looseBeta' } },
					],
				},
				{
					type: 'row',
					fields: [
						{ name: 'rowLeft', type: 'text', admin: { description: 'path: rowLeft' } },
						{ name: 'rowRight', type: 'text', admin: { description: 'path: rowRight' } },
					],
				},
			],
		},

		{
			name: 'named',
			type: 'group',
			label: 'Named group',
			fields: [
				{ name: 'alpha', type: 'text', admin: { description: 'path: named.alpha' } },
				{ name: 'beta', type: 'number' },
				{
					name: 'deep',
					type: 'group',
					fields: [
						{ name: 'value', type: 'text', admin: { description: 'path: named.deep.value' } },
						{
							name: 'list',
							type: 'array',
							admin: { description: 'array in group in group: named.deep.list.N.item' },
							fields: [{ name: 'item', type: 'text' }],
						},
					],
				},
				{
					type: 'group',
					label: 'Unnamed group inside a named group',
					fields: [
						{
							name: 'nestedLoose',
							type: 'text',
							admin: { description: 'path: named.nestedLoose (no extra segment)' },
						},
					],
				},
			],
		},

		{
			name: 'list',
			type: 'array',
			label: 'Array with everything inside it',
			admin: { description: 'rows carry ids, so reorder is distinguishable from edit' },
			fields: [
				{ name: 'title', type: 'text', admin: { description: 'path: list.N.title' } },
				{
					name: 'meta',
					type: 'group',
					fields: [
						{ name: 'note', type: 'text', admin: { description: 'path: list.N.meta.note' } },
						{ name: 'weight', type: 'number' },
					],
				},
				{
					type: 'group',
					label: 'Unnamed group inside an array row',
					fields: [
						{
							name: 'looseInRow',
							type: 'text',
							admin: { description: 'path: list.N.looseInRow' },
						},
					],
				},
				{
					name: 'nested',
					type: 'array',
					label: 'Array in array',
					admin: { description: 'path: list.N.nested.M.value' },
					fields: [
						{ name: 'value', type: 'text' },
						{
							name: 'deeper',
							type: 'array',
							label: 'Array in array in array',
							admin: { description: 'path: list.N.nested.M.deeper.K.leaf' },
							fields: [{ name: 'leaf', type: 'text' }],
						},
					],
				},
				{
					name: 'rowBlocks',
					type: 'blocks',
					label: 'Blocks in array',
					admin: { description: 'path: list.N.rowBlocks.M.<field>' },
					blocks: [heroBlock, cardsBlock],
				},
				{ name: 'rowRich', type: 'richText', label: 'Rich text in array' },
			],
		},

		{
			name: 'sections',
			type: 'blocks',
			label: 'Blocks with arrays, groups, tabs and blocks inside',
			blocks: [heroBlock, cardsBlock, richBlock, tabbedBlock],
		},

		{
			type: 'tabs',
			tabs: [
				{
					label: 'Unnamed tab',
					fields: [
						{
							name: 'inUnnamedTab',
							type: 'text',
							admin: { description: 'path: inUnnamedTab (root level)' },
						},
						{
							name: 'tabArray',
							type: 'array',
							admin: { description: 'path: tabArray.N.value' },
							fields: [{ name: 'value', type: 'text' }],
						},
					],
				},
				{
					name: 'namedTab',
					label: 'Named tab',
					fields: [
						{
							name: 'inNamedTab',
							type: 'text',
							admin: { description: 'path: namedTab.inNamedTab' },
						},
						{
							name: 'group',
							type: 'group',
							fields: [
								{
									name: 'deep',
									type: 'text',
									admin: { description: 'path: namedTab.group.deep' },
								},
							],
						},
						{
							name: 'tabBlocks',
							type: 'blocks',
							admin: { description: 'path: namedTab.tabBlocks.N.<field>' },
							blocks: [heroBlock],
						},
					],
				},
			],
		},
	],
}
