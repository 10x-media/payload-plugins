import type { Block, CollectionSlug } from 'payload'

import { keys } from '../translations/keys'
import { labelForKey } from '../translations/server'
import { GUIDE_LINK_BLOCK_SLUG } from './constants'

/**
 * Guide-to-guide links are an inline block rather than a custom lexical node:
 * the relationship field gives authors a searchable guide picker for free, and
 * the stock inline-block machinery handles insertion, editing, and serialization.
 * The reader-side renderer opens the target guide in a stacked drawer.
 */
export const buildGuideLinkBlock = (pagesSlug: string): Block => ({
	slug: GUIDE_LINK_BLOCK_SLUG,
	interfaceName: 'WikiGuideLinkBlock',
	labels: {
		singular: labelForKey(keys.guideLinkBlockSingular),
		plural: labelForKey(keys.guideLinkBlockPlural),
	},
	admin: {
		components: {
			Label: '@10x-media/admin-wiki/client#GuideLinkBlockLabel',
		},
	},
	fields: [
		{
			name: 'guide',
			type: 'relationship',
			label: labelForKey(keys.guideLinkGuideLabel),
			relationTo: pagesSlug as CollectionSlug,
			required: true,
		},
		{
			name: 'label',
			type: 'text',
			label: labelForKey(keys.guideLinkLabelLabel),
			admin: { description: labelForKey(keys.guideLinkLabelDescription) },
		},
	],
})
