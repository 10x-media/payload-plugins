'use client'

import { createClientFeature } from '@payloadcms/richtext-lexical/client'

import { MentionNode } from './MentionNode'
import type { MentionClientProps } from './server'

export { $createMentionNode, $isMentionNode, MentionNode } from './MentionNode'

/**
 * The client half of the mention feature for Payload's own rich text field:
 * registers the node so a stored body renders there (the messages collection's
 * edit view). Picking users happens in the composer, not in this field.
 */
export const ConversationsMentionFeatureClient = createClientFeature<MentionClientProps>(
	({ props }) => ({
		nodes: [MentionNode],
		sanitizedClientFeatureProps: props,
	})
)
