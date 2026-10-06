import { lexicalEditor } from '@payloadcms/richtext-lexical'
import type { Block } from 'payload'

import type { WikiEditorFeature } from '../options'
import { keys } from '../translations/keys'
import { labelForKey } from '../translations/server'
import { CALLOUT_BLOCK_SLUG } from './constants'

export type BuildCalloutBlockArgs = {
	/** Features of the body editor. The caller is what leaves the callout out of them. */
	bodyFeatures: () => WikiEditorFeature[]
}

/**
 * The plugin's built-in callout block. The slug is prefixed so it can never
 * collide with a consumer project's own blocks; the same slug keys the
 * renderer in `GuideArticle` and the seed's GitHub-alert transformer output.
 */
export const buildCalloutBlock = ({ bodyFeatures }: BuildCalloutBlockArgs): Block => ({
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
			editor: lexicalEditor({ features: bodyFeatures }),
		},
	],
})
