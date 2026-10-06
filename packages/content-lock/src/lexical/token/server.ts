import { createNode, createServerFeature } from '@payloadcms/richtext-lexical'

import { ContentLockTokenServerNode } from './node'
import { TOKEN_FEATURE_KEY } from './types'

/** A group as the scope token's preview labels it, with what it covers. */
export type TokenGroup = {
	key: string
	label: string | Record<string, string>
	collections: string[]
	globals: string[]
	custom: string[]
}

/** A custom target as the scope token names it. */
export type TokenCustomTarget = { key: string; label: string | Record<string, string> }

/** Props the server feature forwards to its client half. */
export type ContentLockTokenClientProps = {
	groups: TokenGroup[]
	customTargets?: TokenCustomTarget[]
}

/**
 * Lock window values inside a banner message: the start, the end, the
 * announcement, the scope, or a fixed date, each an atomic inline chip that
 * previews what the banner will show. A token pointing at something the window
 * does not have (an end on a manual window, a scope on a lock over everything)
 * is flagged on its chip rather than refused on save, and renders as nothing
 * in the banner.
 */
export const ContentLockTokenFeature = createServerFeature<
	ContentLockTokenClientProps,
	ContentLockTokenClientProps,
	ContentLockTokenClientProps
>({
	feature: ({ props }) => ({
		ClientFeature: '@10x-media/content-lock/client#ContentLockTokenFeatureClient',
		clientFeatureProps: { customTargets: props.customTargets ?? [], groups: props.groups },
		nodes: [createNode({ node: ContentLockTokenServerNode })],
		sanitizedServerFeatureProps: props,
	}),
	key: TOKEN_FEATURE_KEY,
})
