import {
	BlocksFeature,
	BoldFeature,
	FixedToolbarFeature,
	ItalicFeature,
	LinkFeature,
	lexicalEditor,
	ParagraphFeature,
} from '@payloadcms/richtext-lexical'
import type { CollectionSlug } from 'payload'

import { dateBlock } from './dateBlock'

/**
 * The lock message editor: short formatted text plus inline dates. It never
 * inherits the project's editor, so a banner cannot grow uploads or blocks.
 */
export const buildMessageEditor = (): ReturnType<typeof lexicalEditor> =>
	lexicalEditor({
		features: () => [
			ParagraphFeature(),
			BoldFeature(),
			ItalicFeature(),
			LinkFeature({ enabledCollections: [] as CollectionSlug[] }),
			BlocksFeature({ inlineBlocks: [dateBlock] }),
			FixedToolbarFeature(),
		],
	})
