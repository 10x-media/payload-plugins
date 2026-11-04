import { DATE_FORMATS, TOKEN_KINDS, TOKEN_NODE_TYPE } from './types'

const union = (values: readonly string[]): string => values.map((value) => `'${value}'`).join(' | ')

/** The generated interface; it has to describe what `exportJSON` writes. */
const SERIALIZED_TOKEN_NODE_TS = `export interface SerializedContentLockTokenNode {
  type: '${TOKEN_NODE_TYPE}';
  token: ${union(TOKEN_KINDS)};
  format?: ${union(DATE_FORMATS)};
  date?: string;
  textFormat?: number;
  /** @deprecated Ignored when loading. */
  version: number;
}`

/**
 * JSON Schema of a token node, so Payload 4 keeps it in the strictly typed
 * node union it generates for every rich text field that has the feature.
 * Without it the node is left out, and a typed message with a token fails to
 * compile in the project.
 */
export const tokenNodeJSONSchema = ({
	typeStringDefinitions,
}: {
	typeStringDefinitions: Set<string>
}) => {
	typeStringDefinitions.add(SERIALIZED_TOKEN_NODE_TS)
	return {
		type: 'object' as const,
		additionalProperties: false,
		properties: {
			type: { type: 'string' as const, const: TOKEN_NODE_TYPE },
			token: { type: 'string' as const, enum: [...TOKEN_KINDS] },
			format: { type: 'string' as const, enum: [...DATE_FORMATS] },
			date: { type: 'string' as const },
			textFormat: { type: 'number' as const },
			version: { type: 'number' as const, deprecated: true },
		},
		required: ['type', 'token'],
		tsType: 'SerializedContentLockTokenNode',
	}
}
