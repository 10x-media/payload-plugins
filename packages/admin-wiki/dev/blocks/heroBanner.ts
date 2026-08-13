import { colorField } from '@10x-media/fields/color'
import type { Block } from 'payload'

/**
 * A registry block (`config.blocks`), referenced by both `posts.layout` and
 * `products.layout`. Shared on purpose: a guide on `block:heroBanner.heading`
 * has to surface at both usages from the one target.
 */
export const heroBannerBlock: Block = {
	slug: 'heroBanner',
	labels: { singular: 'Hero banner', plural: 'Hero banners' },
	fields: [{ name: 'heading', type: 'text', localized: true }, colorField({ name: 'background' })],
}
