import type { CollectionConfig } from 'payload'

/**
 * A second collection so collection-level guides are demonstrable. Its `layout`
 * reuses the shared `heroBanner` block, which is what makes the block-scoped
 * field targets visible: the guide written on `block:heroBanner.heading` shows
 * up here and on posts from a single target. It also renders the registry `cta`,
 * whose slug the `settings` global declares inline with different fields.
 */
export const products: CollectionConfig = {
	slug: 'products',
	admin: { useAsTitle: 'name' },
	fields: [
		{ name: 'name', type: 'text', localized: true, required: true },
		{ name: 'price', type: 'number' },
		{ name: 'description', type: 'textarea', localized: true },
		{ name: 'layout', type: 'blocks', blockReferences: ['heroBanner', 'cta'], blocks: [] },
	],
}
