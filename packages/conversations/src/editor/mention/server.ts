import { createNode, createServerFeature } from '@payloadcms/richtext-lexical'

import { MentionServerNode } from './node'
import { mentionNodeJSONSchema } from './schema'

/** Props the server feature forwards to its client half. */
export type MentionClientProps = {
	/** The instance slug, for the mention search endpoint. */
	instance: string
}

/**
 * Mentions for the conversations editor: an inline node carrying a `userKey`,
 * picked through a typeahead on `@`. The server half registers the node so a
 * stored body validates and shows in generated types; extraction of mentioned users happens
 * in the messages collection, not here.
 */
export const ConversationsMentionFeature = createServerFeature<
	MentionClientProps,
	MentionClientProps,
	MentionClientProps
>({
	feature: ({ props }) => ({
		ClientFeature: '@10x-media/conversations/client#ConversationsMentionFeatureClient',
		clientFeatureProps: { instance: props.instance },
		nodes: [createNode({ jsonSchema: mentionNodeJSONSchema, node: MentionServerNode })],
		sanitizedServerFeatureProps: props,
	}),
	key: 'conversationsMention',
})
