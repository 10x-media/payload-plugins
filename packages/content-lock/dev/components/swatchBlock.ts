import type { Block } from 'payload'

/**
 * A dev inline block for banner messages: a small coloured square. It exists
 * to show that `editor.features` and `editor.converters` reach the banner.
 */
export const swatchBlock: Block = {
	slug: 'swatch',
	labels: { singular: 'Swatch', plural: 'Swatches' },
	fields: [
		{
			name: 'color',
			type: 'select',
			required: true,
			defaultValue: 'black',
			options: ['black', 'red', 'amber', 'green'],
		},
	],
}
