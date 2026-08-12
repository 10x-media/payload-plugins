import type { Block } from 'payload'

/** A consumer-supplied wiki editor block, proving `options.editor.blocks`. */
export const tipBlock: Block = {
	slug: 'devTip',
	labels: { singular: 'Dev tip', plural: 'Dev tips' },
	fields: [{ name: 'tip', type: 'textarea', required: true }],
}
