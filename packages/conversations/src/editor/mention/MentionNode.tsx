import { $applyNodeReplacement, type LexicalNode } from '@payloadcms/richtext-lexical/lexical'

import { type MentionData, MentionServerNode } from './node'
import './mention.css'

const MentionChip = ({ label, userKey }: MentionData) => (
	<span className="conversations-mention" data-user={userKey}>
		@{label}
	</span>
)

/**
 * The mention node in the browser: the server node plus its chip. Shared by
 * the composer and Payload's field, and free of `@payloadcms/ui`.
 */
export class MentionNode extends MentionServerNode {
	static override getType(): string {
		return MentionServerNode.getType()
	}

	static override clone(node: MentionNode): MentionNode {
		return new MentionNode({ key: node.__key, label: node.__label, userKey: node.__userKey })
	}

	static override importJSON(serializedNode: Parameters<typeof MentionServerNode.importJSON>[0]) {
		return $createMentionNode({ label: serializedNode.label, userKey: serializedNode.userKey })
	}

	override decorate() {
		return <MentionChip label={this.__label} userKey={this.__userKey} />
	}
}

export const $createMentionNode = (data: MentionData): MentionNode =>
	$applyNodeReplacement(new MentionNode(data))

export const $isMentionNode = (node: LexicalNode | null | undefined): node is MentionNode =>
	node instanceof MentionNode
