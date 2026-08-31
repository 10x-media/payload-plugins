import { createNode, createServerFeature } from '@payloadcms/richtext-lexical'

import { WikiGuideLinkNode } from './guideLinkNode'

/** Props the server feature forwards to its client half. */
export type WikiGuideLinkClientProps = {
	pagesSlug: string
}

/**
 * Guide-to-guide links for the wiki editor: an inline ElementNode wrapping the
 * author's own text, picked from the guides list drawer.
 *
 * Deliberately not Payload's `LinkFeature` with internal links enabled. That one
 * carries a URL, a target, a rel, and an entity picker across every enabled
 * collection, and its edit UI is built around all of it; a guide link is one
 * question ("which guide?") and opens a drawer rather than navigating, so the
 * two only look alike from a distance.
 */
export const WikiGuideLinkFeature = createServerFeature<
	WikiGuideLinkClientProps,
	WikiGuideLinkClientProps,
	WikiGuideLinkClientProps
>({
	feature: ({ props }) => ({
		ClientFeature: '@10x-media/admin-wiki/client#WikiGuideLinkFeatureClient',
		clientFeatureProps: { pagesSlug: props.pagesSlug },
		nodes: [createNode({ node: WikiGuideLinkNode })],
		sanitizedServerFeatureProps: props,
	}),
	key: 'wikiGuideLink',
})
