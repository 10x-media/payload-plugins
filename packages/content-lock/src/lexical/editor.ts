import {
	BoldFeature,
	FixedToolbarFeature,
	ItalicFeature,
	type LexicalEditorProps,
	LinkFeature,
	lexicalEditor,
} from '@payloadcms/richtext-lexical'
import type { CollectionSlug } from 'payload'

import { ContentLockTokenFeature, type TokenCustomTarget, type TokenGroup } from './token/server'

/**
 * One lexical feature, exactly as `lexicalEditor` takes them. Derived from its
 * own props, because the feature type is generic over prop types this plugin
 * has no business naming.
 */
export type ContentLockEditorFeature = Extract<
	NonNullable<LexicalEditorProps['features']>,
	readonly unknown[]
>[number]

/**
 * Lexical features for the banner message editor. The array form appends to
 * the plugin's own; the function form gets them as `defaultFeatures` and
 * returns the whole list, so it can reorder or drop one. Dropping the token
 * feature takes the lock values with it.
 */
export type ContentLockEditorFeaturesOption =
	| ContentLockEditorFeature[]
	| ((args: { defaultFeatures: ContentLockEditorFeature[] }) => ContentLockEditorFeature[])

/**
 * The banner message editor: short formatted text plus lock value tokens. It
 * never inherits the project's editor, so a banner cannot grow uploads or
 * blocks unless `features` adds them. Paragraphs are Lexical's own; leaving out
 * `ParagraphFeature` only drops the text-type dropdown, which would offer
 * nothing but "Normal text" here.
 */
export const buildMessageEditor = ({
	groups,
	customTargets = [],
	features,
}: {
	groups: TokenGroup[]
	customTargets?: TokenCustomTarget[]
	features?: ContentLockEditorFeaturesOption
}): ReturnType<typeof lexicalEditor> =>
	lexicalEditor({
		features: () => {
			const defaultFeatures: ContentLockEditorFeature[] = [
				BoldFeature(),
				ItalicFeature(),
				LinkFeature({ enabledCollections: [] as CollectionSlug[] }),
				ContentLockTokenFeature({ customTargets, groups }),
				FixedToolbarFeature(),
			]
			if (!features) {
				return defaultFeatures
			}
			return typeof features === 'function'
				? features({ defaultFeatures })
				: [...defaultFeatures, ...features]
		},
	})
