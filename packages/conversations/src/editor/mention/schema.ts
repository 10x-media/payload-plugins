import { MENTION_NODE_TYPE } from './constants'

/** The generated interface; it has to describe what `exportJSON` writes. */
const SERIALIZED_MENTION_NODE_TS = `export interface SerializedConversationsMentionNode {
  type: '${MENTION_NODE_TYPE}';
  /** The name at the time of mentioning; readers prefer the live projection. */
  label: string;
  userKey: string;
  /** @deprecated Ignored when loading. */
  version: number;
}`

/**
 * JSON Schema of a mention node, so Payload 4 keeps it in the strictly typed
 * node union it generates for every rich text field that has the feature.
 * Without it the node is left out, and a typed body with a mention fails to
 * compile in the project.
 */
export const mentionNodeJSONSchema = ({
	typeStringDefinitions,
}: {
	typeStringDefinitions: Set<string>
}) => {
	typeStringDefinitions.add(SERIALIZED_MENTION_NODE_TS)
	return {
		type: 'object' as const,
		additionalProperties: false,
		properties: {
			type: { type: 'string' as const, const: MENTION_NODE_TYPE },
			label: { type: 'string' as const },
			userKey: { type: 'string' as const },
			version: { type: 'number' as const, deprecated: true },
		},
		required: ['type', 'label', 'userKey'],
		tsType: 'SerializedConversationsMentionNode',
	}
}
