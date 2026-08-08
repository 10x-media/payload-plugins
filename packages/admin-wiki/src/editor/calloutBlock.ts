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

/**
 * Minimal nested editor for the callout body: inline formatting and external
 * links only, so callouts cannot recursively nest blocks, uploads, or video.
 */
const calloutBodyEditor = () =>
	lexicalEditor({
		features: () => [
			ParagraphFeature(),
			BoldFeature(),
			ItalicFeature(),
			UnderlineFeature(),
			InlineCodeFeature(),
			LinkFeature({ enabledCollections: [] as CollectionSlug[] }),
			InlineToolbarFeature(),
		],
	})

/**
 * The plugin's built-in callout block. The slug is prefixed so it can never
 * collide with a consumer project's own blocks; the same slug keys the
 * renderer in `GuideArticle` and the seed's GitHub-alert transformer output.
 */
export const buildCalloutBlock = (): Block => ({
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
			editor: calloutBodyEditor(),
		},
	],
})
