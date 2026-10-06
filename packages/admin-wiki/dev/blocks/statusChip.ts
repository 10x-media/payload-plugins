import type { Block } from 'payload'

export const statusChipBlock: Block = {
	slug: 'devStatusChip',
	labels: { singular: 'Status chip', plural: 'Status chips' },
	fields: [
		{
			name: 'tone',
			type: 'select',
			required: true,
			defaultValue: 'new',
			options: [
				{ label: 'New', value: 'new' },
				{ label: 'Deprecated', value: 'deprecated' },
			],
		},
		{ name: 'label', type: 'text', required: true },
	],
}
