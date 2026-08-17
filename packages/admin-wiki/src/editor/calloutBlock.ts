import {
	BoldFeature,
	InlineCodeFeature,
	InlineToolbarFeature,
	ItalicFeature,
	LinkFeature,
	lexicalEditor,
	ParagraphFeature,
	UnderlineFeature,
} from '@payloadcms/richtext-lexical'
import type { Block, CollectionSlug } from 'payload'

import { keys } from '../translations/keys'
import { labelForKey } from '../translations/server'
import { CALLOUT_BLOCK_SLUG } from './constants'
import { WikiGuideLinkFeature } from './guideLink/server'

/**
 * Minimal nested editor for the callout body: inline formatting, external links
 * and guide links, so callouts cannot recursively nest blocks, uploads, or
 * video. Guide links belong here because a callout is where a cross-reference
 * most often reads ("see X before you do this"), and because the seed rewrites
 * placeholders wherever they appear, callout bodies included.
 */
const calloutBodyEditor = (pagesSlug: string) =>
	lexicalEditor({
		features: () => [
			ParagraphFeature(),
			BoldFeature(),
			ItalicFeature(),
			UnderlineFeature(),
			InlineCodeFeature(),
			LinkFeature({ enabledCollections: [] as CollectionSlug[] }),
			WikiGuideLinkFeature({ pagesSlug }),
			InlineToolbarFeature(),
		],
	})

export type BuildCalloutBlockArgs = {
	/** Slug of the wiki pages collection, for guide links inside a callout. */
	pagesSlug: string
}

/**
 * The plugin's built-in callout block. The slug is prefixed so it can never
 * collide with a consumer project's own blocks; the same slug keys the
 * renderer in `GuideArticle` and the seed's GitHub-alert transformer output.
 */
export const buildCalloutBlock = ({ pagesSlug }: BuildCalloutBlockArgs): Block => ({
	slug: CALLOUT_BLOCK_SLUG,
	interfaceName: 'WikiCalloutBlock',
	labels: {
		singular: labelForKey(keys.calloutBlockSingular),
		plural: labelForKey(keys.calloutBlockPlural),
	},
	admin: {
		components: { Label: '@10x-media/admin-wiki/client#CalloutBlockLabel' },
	},
	fields: [
		{
			name: 'variant',
			type: 'select',
			label: labelForKey(keys.calloutVariantLabel),
			required: true,
			defaultValue: 'info',
			options: [
				{ label: labelForKey(keys.calloutVariantInfo), value: 'info' },
				{ label: labelForKey(keys.calloutVariantTip), value: 'tip' },
				{ label: labelForKey(keys.calloutVariantWarning), value: 'warning' },
				{ label: labelForKey(keys.calloutVariantDanger), value: 'danger' },
			],
		},
		{
			name: 'body',
			type: 'richText',
			label: labelForKey(keys.calloutBodyLabel),
			editor: calloutBodyEditor(pagesSlug),
		},
	],
})
