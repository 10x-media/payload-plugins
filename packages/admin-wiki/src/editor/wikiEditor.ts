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
import type { CollectionSlug, UploadCollectionSlug } from 'payload'

import type {
	WikiEditorBlockOption,
	WikiEditorFeature,
	WikiEditorFeaturesOption,
	WikiVideoOptions,
} from '../options'
import { DEFAULT_MEDIA_SLUG, DEFAULT_PAGES_SLUG } from '../plugin/slugs'
import { WikiBlockquoteFeature } from './blockquoteFeature'
import { buildCalloutBlock } from './calloutBlock'
import { WikiGuideLinkFeature } from './guideLink/server'
import { WikiVideoFeature } from './video/server'
import { buildVideoEmbedBlock } from './videoEmbedBlock'

export type WikiFeaturesArgs = {
	/** Consumer blocks; only those marked `nestable` reach a nested editor. */
	blocks?: WikiEditorBlockOption[]
	/** Consumer lexical features, appended to the plugin's own or replacing the list. */
	features?: WikiEditorFeaturesOption
	/** Consumer inline blocks; the plugin ships none of its own. */
	inlineBlocks?: WikiEditorBlockOption[]
	/** Slug of the wiki media upload collection; pass it when the project renamed it. */
	mediaSlug?: string
	/** Whether the editor sits inside something: a callout body, or a consumer block. */
	nested?: boolean
	/** Slug of the wiki pages collection; pass it when the project renamed it. */
	pagesSlug?: string
	/** Resolved video options; false leaves every video capability unregistered. */
	video?: false | WikiVideoOptions
}

/** Blocks a nested editor takes, `fallback` standing in for an unset `nestable`. */
const nestableBlocks = (options: WikiEditorBlockOption[], fallback: boolean) =>
	options.filter((option) => option.nestable ?? fallback).map((option) => option.block)

/**
 * The plugin's own feature list. A consumer block holding its own rich text
 * field reuses it with `nested: true`.
 *
 * Stock links are external-URL only (`enabledCollections: []` removes internal
 * doc links) and guide-to-guide links are their own feature beside them; uploads
 * are scoped to the wiki media collection.
 *
 * `nested` drops the callout and headings (the table-of-contents walk does not
 * descend into a nested editor state, so a heading there would get no id), the
 * fixed toolbar, and the features the callout body has no vertical room for:
 * lists, blockquote, horizontal rule and indent.
 */
export const wikiFeatures = ({
	blocks = [],
	features,
	inlineBlocks = [],
	mediaSlug = DEFAULT_MEDIA_SLUG,
	nested = false,
	pagesSlug = DEFAULT_PAGES_SLUG,
	video = false,
}: WikiFeaturesArgs): WikiEditorFeature[] => {
	const nestedBlocks = nested
		? [...(video !== false ? [buildVideoEmbedBlock()] : []), ...nestableBlocks(blocks, false)]
		: []
	const nestedInlineBlocks = nested ? nestableBlocks(inlineBlocks, true) : []
	const carriesBlocks = !nested || nestedBlocks.length > 0 || nestedInlineBlocks.length > 0

	const defaultFeatures: WikiEditorFeature[] = [
		ParagraphFeature(),
		BoldFeature(),
		ItalicFeature(),
		UnderlineFeature(),
		StrikethroughFeature(),
		InlineCodeFeature(),
		AlignFeature(),
		LinkFeature({ enabledCollections: [] as CollectionSlug[] }),
		WikiGuideLinkFeature({ pagesSlug }),
		UploadFeature({ enabledCollections: [mediaSlug] as UploadCollectionSlug[] }),
		...(video !== false ? [WikiVideoFeature({ mediaSlug })] : []),
		...(nested
			? []
			: [
					HeadingFeature({ enabledHeadingSizes: ['h2', 'h3', 'h4'] }),
					UnorderedListFeature(),
					OrderedListFeature(),
					WikiBlockquoteFeature(),
					HorizontalRuleFeature(),
					IndentFeature(),
					FixedToolbarFeature(),
				]),
		...(carriesBlocks
			? [
					BlocksFeature({
						blocks: nested
							? nestedBlocks
							: [
									buildCalloutBlock({
										bodyFeatures: () =>
											wikiFeatures({
												blocks,
												features,
												inlineBlocks,
												mediaSlug,
												nested: true,
												pagesSlug,
												video,
											}),
									}),
									...(video !== false ? [buildVideoEmbedBlock()] : []),
									...blocks.map((option) => option.block),
								],
						inlineBlocks: nested ? nestedInlineBlocks : inlineBlocks.map((option) => option.block),
					}),
				]
			: []),
		InlineToolbarFeature(),
	]

	if (features === undefined) {
		return defaultFeatures
	}
	return typeof features === 'function'
		? features({ defaultFeatures, nested })
		: [...defaultFeatures, ...features]
}

/**
 * The plugin's self-contained editor: an explicit feature list that never
 * inherits the consuming project's editor or its link customizations.
 *
 * Closed to the *project's* editor, not to the project: `options.editor.features`
 * adds to this list or reshapes it. The list is assembled inside `features()`
 * rather than beforehand, so a consumer's function sees it exactly as the
 * resolved options built it, video branch included.
 */
export const buildWikiEditor = (args: WikiFeaturesArgs): ReturnType<typeof lexicalEditor> =>
	lexicalEditor({ features: () => wikiFeatures(args) })
