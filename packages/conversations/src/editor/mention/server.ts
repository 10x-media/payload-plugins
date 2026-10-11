import { createNode, createServerFeature } from '@payloadcms/richtext-lexical'

import { MentionServerNode, type SerializedMentionNode } from './node'

/** Props the server feature forwards to its client half. */
export type MentionClientProps = {
	/** The instance slug, for the mention search endpoint. */
	instance: string
}

/**
 * Mentions for the conversations editor: an inline node carrying a `userKey`,
 * picked through a typeahead on `@`. The server half registers the node so a
 * stored body validates and converts; extraction of mentioned users happens
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
		nodes: [
			createNode({
				converters: {
					html: {
						converter: ({ node }) => {
							const mention = node as SerializedMentionNode
							return `<span data-conversations-mention="${escapeAttribute(mention.userKey)}">@${escapeText(mention.label)}</span>`
						},
						nodeTypes: [MentionServerNode.getType()],
					},
				},
				node: MentionServerNode,
			}),
		],
		sanitizedServerFeatureProps: props,
	}),
	key: 'conversationsMention',
})

const escapeText = (value: string) =>
	value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const escapeAttribute = (value: string) => escapeText(value).replace(/"/g, '&quot;')
