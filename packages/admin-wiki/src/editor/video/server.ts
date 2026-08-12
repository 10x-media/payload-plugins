import { createNode, createServerFeature } from '@payloadcms/richtext-lexical'

import { WikiVideoServerNode } from './videoNode'

/** Props the server feature forwards to its client half. */
export type WikiVideoClientProps = {
	mediaSlug: string
}

/**
 * Uploaded-video feature for the wiki editor: a DecoratorNode referencing a
 * wiki-media document, playable inline while authoring. Registered only when
 * `options.video` is enabled, so no video code is reachable otherwise.
 */
export const WikiVideoFeature = createServerFeature<
	WikiVideoClientProps,
	WikiVideoClientProps,
	WikiVideoClientProps
>({
	feature: ({ props }) => ({
		ClientFeature: '@10x-media/admin-wiki/client#WikiVideoFeatureClient',
		clientFeatureProps: { mediaSlug: props.mediaSlug },
		i18n: {
			de: { label: 'Video' },
			en: { label: 'Video' },
		},
		nodes: [createNode({ node: WikiVideoServerNode })],
		sanitizedServerFeatureProps: props,
	}),
	key: 'wikiVideo',
})
