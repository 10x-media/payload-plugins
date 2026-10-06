import type { CollectionConfig } from 'payload'

import { defineFormVariants } from '../../src/index'

/**
 * Every presentational container Payload has, so a step can pull fields out of each one and
 * the result can be held against the native form side by side. Rows and unnamed groups and
 * tabs leave the data path alone; named groups and named tabs prefix it; a collapsible is
 * only a lid. `status` and `owner` are the sidebar column, which a step has no equivalent of.
 *
 * `split` takes leaves out of every container, one container per step. `whole` takes each
 * container Payload lets you name: group, named tab, array and blocks. `collapsible` and `row`
 * cannot be named at all, so they have no whole form to take.
 */
export const containers: CollectionConfig = {
	slug: 'containers',
	admin: { defaultColumns: ['reference', 'status'], useAsTitle: 'reference' },
	custom: {
		formVariants: defineFormVariants('containers', {
			defaultVariant: 'split',
			variants: [
				{
					key: 'split',
					label: 'Leaves',
					navigation: 'free',
					save: 'always',
					steps: [
						{
							key: 'row',
							label: 'Row',
							description: 'Two fields that share a row on the native form, and one that does not.',
							fields: ['reference', 'firstName', 'lastName'],
						},
						{
							key: 'collapsible',
							label: 'Collapsible',
							description:
								'A field from a collapsible, and two from a row inside that collapsible.',
							fields: ['nickname', 'height', 'weight'],
						},
						{
							key: 'groups',
							label: 'Groups',
							description: 'A named group, a group nested in it, and an unnamed one.',
							fields: ['contact.email', 'contact.phone', 'contact.postal.city', 'note'],
						},
						{
							key: 'tabs',
							label: 'Tabs',
							description:
								'An unnamed tab, a row inside it, two named tabs, and a collapsible in one.',
							fields: [
								'summary',
								'startsOn',
								'endsOn',
								'meta.slug',
								'meta.keywords',
								'seo.title',
								'seo.canonical',
							],
						},
						{
							key: 'sidebar',
							label: 'Sidebar',
							description: 'Fields Payload puts in its own column. A step has one column only.',
							fields: ['status', 'owner'],
						},
					],
				},
				{
					key: 'whole',
					label: 'Whole containers',
					navigation: 'free',
					save: 'always',
					steps: [
						{
							key: 'group',
							label: 'Group',
							description: 'The named group as one field, nested group and all.',
							fields: ['contact'],
						},
						{
							key: 'nested',
							label: 'Nested group',
							description: 'The named group inside that group, on its own.',
							fields: ['contact.postal'],
						},
						{
							key: 'array',
							label: 'Array',
							description: 'A named container the index stops at, so the rows come whole.',
							fields: ['items'],
						},
						{
							key: 'tab',
							label: 'Named tab',
							description: 'A named tab, which the data shapes exactly as a group.',
							fields: ['meta'],
						},
						{
							key: 'blocks',
							label: 'Blocks',
							description: 'The same, with the block picker.',
							fields: ['sections'],
						},
						{
							key: 'rest',
							label: 'Leaves',
							description: 'Plain fields again, to compare the spacing against the steps before.',
							fields: ['reference', 'summary'],
						},
					],
				},
				{
					key: 'laid-out',
					label: 'Laid out',
					navigation: 'free',
					save: 'always',
					steps: [
						{
							key: 'who',
							label: 'Who',
							description: 'Containers the step draws itself, over fields that sit apart.',
							fields: [
								{ type: 'row', fields: ['firstName', 'lastName'] },
								{
									type: 'row',
									fields: [
										{ path: 'reference', admin: { width: '70%' } },
										{ path: 'status', admin: { width: '30%' } },
									],
								},
								{
									type: 'group',
									label: 'Reaching them',
									description: 'A group of the step, over fields from the collection group.',
									fields: [
										{ type: 'component', Component: './components/ContainerNote#ContainerNote' },
										{ type: 'row', fields: ['contact.email', 'contact.phone'] },
										'contact.postal.city',
									],
								},
								{
									type: 'collapsible',
									label: 'Rarely needed',
									initCollapsed: true,
									fields: ['nickname', { type: 'row', fields: ['height', 'weight'] }, 'note'],
								},
							],
						},
					],
				},
				{ key: 'native', label: 'Native' },
			],
		}),
	},
	fields: [
		{ name: 'reference', type: 'text', required: true },
		{
			type: 'row',
			fields: [
				{ name: 'firstName', type: 'text', admin: { width: '70%' } },
				{ name: 'lastName', type: 'text', admin: { width: '30%' } },
			],
		},
		{
			type: 'collapsible',
			label: 'Advanced',
			admin: { initCollapsed: true },
			fields: [
				{ name: 'nickname', type: 'text' },
				{
					type: 'row',
					fields: [
						{ name: 'height', type: 'number' },
						{ name: 'weight', type: 'number' },
					],
				},
			],
		},
		{
			name: 'contact',
			type: 'group',
			fields: [
				{ name: 'email', type: 'email' },
				{ name: 'phone', type: 'text' },
				{
					name: 'postal',
					type: 'group',
					fields: [
						{ name: 'street', type: 'text' },
						{ name: 'city', type: 'text' },
					],
				},
			],
		},
		{
			type: 'group',
			label: 'Unnamed group',
			fields: [{ name: 'note', type: 'textarea' }],
		},
		{
			type: 'tabs',
			tabs: [
				{
					label: 'Overview',
					fields: [
						{ name: 'summary', type: 'textarea' },
						{
							type: 'row',
							fields: [
								{ name: 'startsOn', type: 'date' },
								{ name: 'endsOn', type: 'date' },
							],
						},
					],
				},
				{
					name: 'meta',
					label: 'Meta',
					fields: [
						{ name: 'slug', type: 'text' },
						{ name: 'keywords', type: 'text' },
					],
				},
				{
					name: 'seo',
					label: 'SEO',
					fields: [
						{ name: 'title', type: 'text' },
						{
							type: 'collapsible',
							label: 'Canonical',
							fields: [{ name: 'canonical', type: 'text' }],
						},
					],
				},
			],
		},
		{
			name: 'items',
			type: 'array',
			labels: { plural: 'Items', singular: 'Item' },
			fields: [
				{ name: 'label', type: 'text', required: true },
				{ name: 'amount', type: 'number' },
			],
		},
		{
			name: 'sections',
			type: 'blocks',
			blocks: [
				{
					slug: 'quote',
					fields: [
						{ name: 'text', type: 'textarea', required: true },
						{ name: 'author', type: 'text' },
					],
				},
			],
		},
		{
			name: 'status',
			type: 'select',
			admin: { position: 'sidebar' },
			defaultValue: 'draft',
			options: ['draft', 'review', 'done'],
		},
		{ name: 'owner', type: 'relationship', relationTo: 'users', admin: { position: 'sidebar' } },
	],
}
