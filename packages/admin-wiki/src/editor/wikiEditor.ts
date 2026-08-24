import {
	AlignFeature,
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

import type { WikiEditorFeature, WikiEditorFeaturesOption, WikiVideoOptions } from '../options'
import { WikiBlockquoteFeature } from './blockquoteFeature'
import { buildCalloutBlock } from './calloutBlock'
import { WikiGuideLinkFeature } from './guideLink/server'
import { WikiVideoFeature } from './video/server'
import { buildVideoEmbedBlock } from './videoEmbedBlock'

export type BuildWikiEditorArgs = {
	/** Consumer blocks added to the editor alongside the built-in callout. */
	blocks?: Block[]
	/** Consumer lexical features, appended to the plugin's own or replacing the list. */
	features?: WikiEditorFeaturesOption
	/** Consumer inline blocks; the plugin ships none of its own. */
	inlineBlocks?: Block[]
	/** Slug of the wiki media upload collection the upload feature is scoped to. */
	mediaSlug: string
	/** Slug of the wiki pages collection, for guide-to-guide links. */
	pagesSlug: string
	/** Resolved video options; false leaves every video capability unregistered. */
	video?: false | WikiVideoOptions
}

/**
 * The plugin's self-contained editor: an explicit feature list that never
 * inherits the consuming project's editor or its link customizations. Stock
 * links are external-URL only (`enabledCollections: []` removes internal doc
 * links) and guide-to-guide links are their own feature beside them; uploads are
 * scoped to the wiki media collection.
 *
 * Closed to the *project's* editor, not to the project: `options.editor.features`
 * adds to this list or reshapes it. The list is assembled inside `features()`
 * rather than beforehand, so a consumer's function sees it exactly as the
 * resolved options built it, video branch included.
 */
export const buildWikiEditor = ({
	blocks = [],
	features,
	inlineBlocks = [],
	mediaSlug,
	pagesSlug,
	video = false,
}: BuildWikiEditorArgs) =>
	lexicalEditor({
		features: () => {
			const defaultFeatures: WikiEditorFeature[] = [
				ParagraphFeature(),
				HeadingFeature({ enabledHeadingSizes: ['h2', 'h3', 'h4'] }),
				BoldFeature(),
				ItalicFeature(),
				UnderlineFeature(),
				StrikethroughFeature(),
				InlineCodeFeature(),
				UnorderedListFeature(),
				OrderedListFeature(),
				WikiBlockquoteFeature(),
				HorizontalRuleFeature(),
				AlignFeature(),
				IndentFeature(),
				LinkFeature({ enabledCollections: [] as CollectionSlug[] }),
				WikiGuideLinkFeature({ pagesSlug }),
				UploadFeature({ enabledCollections: [mediaSlug] as UploadCollectionSlug[] }),
				BlocksFeature({
					blocks: [
						buildCalloutBlock({ pagesSlug }),
						...(video !== false ? [buildVideoEmbedBlock()] : []),
						...blocks,
					],
					inlineBlocks,
				}),
				...(video !== false ? [WikiVideoFeature({ mediaSlug })] : []),
				FixedToolbarFeature(),
				InlineToolbarFeature(),
			]
			if (features === undefined) {
				return defaultFeatures
			}
			return typeof features === 'function'
				? features({ defaultFeatures })
				: [...defaultFeatures, ...features]
		},
	})
