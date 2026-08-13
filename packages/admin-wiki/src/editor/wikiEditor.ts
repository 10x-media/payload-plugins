import {
	AlignFeature,
	BlockquoteFeature,
	BlocksFeature,
	BoldFeature,
	FixedToolbarFeature,
	HeadingFeature,
	HorizontalRuleFeature,
	IndentFeature,
	InlineCodeFeature,
	InlineToolbarFeature,
	ItalicFeature,
	LinkFeature,
	lexicalEditor,
	OrderedListFeature,
	ParagraphFeature,
	StrikethroughFeature,
	UnderlineFeature,
	UnorderedListFeature,
	UploadFeature,
} from '@payloadcms/richtext-lexical'
import type { Block, CollectionSlug, UploadCollectionSlug } from 'payload'

import type { WikiVideoOptions } from '../options'
import { buildCalloutBlock } from './calloutBlock'
import { WikiGuideLinkFeature } from './guideLink/server'
import { WikiVideoFeature } from './video/server'
import { buildVideoEmbedBlock } from './videoEmbedBlock'

export type BuildWikiEditorArgs = {
	/** Consumer blocks added to the editor alongside the built-in callout. */
	blocks?: Block[]
	/** Slug of the wiki media upload collection the upload feature is scoped to. */
	mediaSlug: string
	/** Slug of the wiki pages collection, for guide-to-guide links. */
	pagesSlug: string
	/** Resolved video options; false leaves every video capability unregistered. */
	video?: false | WikiVideoOptions
}

/**
 * The plugin's self-contained editor: an explicit, closed feature list that
 * never inherits the consuming project's editor or its link customizations.
 * Stock links are external-URL only (`enabledCollections: []` removes internal
 * doc links) and guide-to-guide links are their own feature beside them; uploads
 * are scoped to the wiki media collection.
 */
export const buildWikiEditor = ({
	blocks = [],
	mediaSlug,
	pagesSlug,
	video = false,
}: BuildWikiEditorArgs) =>
	lexicalEditor({
		features: () => [
			ParagraphFeature(),
			HeadingFeature({ enabledHeadingSizes: ['h2', 'h3', 'h4'] }),
			BoldFeature(),
			ItalicFeature(),
			UnderlineFeature(),
			StrikethroughFeature(),
			InlineCodeFeature(),
			UnorderedListFeature(),
			OrderedListFeature(),
			BlockquoteFeature(),
			HorizontalRuleFeature(),
			AlignFeature(),
			IndentFeature(),
			LinkFeature({ enabledCollections: [] as CollectionSlug[] }),
			WikiGuideLinkFeature({ pagesSlug }),
			UploadFeature({ enabledCollections: [mediaSlug] as UploadCollectionSlug[] }),
			BlocksFeature({
				blocks: [
					buildCalloutBlock(),
					...(video !== false ? [buildVideoEmbedBlock()] : []),
					...blocks,
				],
			}),
			...(video !== false ? [WikiVideoFeature({ mediaSlug })] : []),
			FixedToolbarFeature(),
			InlineToolbarFeature(),
		],
	})
