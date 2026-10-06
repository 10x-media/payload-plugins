import type {
	DOMConversionMap,
	DOMConversionOutput,
	DOMExportOutput,
	EditorConfig,
	LexicalNode,
	LexicalUpdateJSON,
	NodeKey,
	SerializedLexicalNode,
	Spread,
} from '@payloadcms/richtext-lexical/lexical'
import { $applyNodeReplacement, DecoratorNode } from '@payloadcms/richtext-lexical/lexical'

import { MENTION_NODE_TYPE } from './constants'

export type MentionData = {
	/** The name at the time of mentioning; the reader prefers the live projection. */
	label: string
	userKey: string
}

export type SerializedMentionNode = Spread<
	MentionData & { type: typeof MENTION_NODE_TYPE },
	SerializedLexicalNode
>

/**
 * An inline, atomic mention of a user. The server half: it renders no React
 * (`decorate` returns null) so the server can load it for validation and
 * conversion. The client subclass in `client.tsx` supplies the chip.
 */
export class MentionServerNode extends DecoratorNode<unknown> {
	__label: string
	__userKey: string

	constructor({ key, label, userKey }: MentionData & { key?: NodeKey }) {
		super(key)
		this.__label = label
		this.__userKey = userKey
	}

	static override clone(node: MentionServerNode): MentionServerNode {
		return new this({ key: node.__key, label: node.__label, userKey: node.__userKey })
	}

	static override getType(): string {
		return MENTION_NODE_TYPE
	}

	static override importDOM(): DOMConversionMap | null {
		return {
			span: (domNode: HTMLElement) =>
				domNode.hasAttribute('data-conversations-mention')
					? { conversion: $convertMentionElement, priority: 1 }
					: null,
		}
	}

	static override importJSON(serializedNode: SerializedMentionNode): MentionServerNode {
		return $createMentionServerNode({
			label: serializedNode.label,
			userKey: serializedNode.userKey,
		}).updateFromJSON(serializedNode)
	}

	override createDOM(config: EditorConfig): HTMLElement {
		const element = document.createElement('span')
		element.className = config.theme.conversationsMention ?? 'conversations-mention'
		return element
	}

	override decorate(): unknown {
		return null
	}

	override exportDOM(): DOMExportOutput {
		const element = document.createElement('span')
		element.setAttribute('data-conversations-mention', this.__userKey)
		element.textContent = `@${this.__label}`
		return { element }
	}

	override exportJSON(): SerializedMentionNode {
		return {
			...super.exportJSON(),
			label: this.getLatest().__label,
			type: MENTION_NODE_TYPE,
			userKey: this.getLatest().__userKey,
			version: 1,
		}
	}

	getLabel(): string {
		return this.getLatest().__label
	}

	override getTextContent(): string {
		return `@${this.getLatest().__label}`
	}

	getUserKey(): string {
		return this.getLatest().__userKey
	}

	override isInline(): true {
		return true
	}

	override isKeyboardSelectable(): boolean {
		return true
	}

	override updateDOM(): false {
		return false
	}

	override updateFromJSON(serializedNode: LexicalUpdateJSON<SerializedMentionNode>): this {
		return super.updateFromJSON(serializedNode)
	}
}

const $convertMentionElement = (domNode: HTMLElement): DOMConversionOutput => {
	const userKey = domNode.getAttribute('data-conversations-mention')
	const label = (domNode.textContent ?? '').replace(/^@/, '')
	return { node: userKey ? $createMentionServerNode({ label, userKey }) : null }
}

export const $createMentionServerNode = (data: MentionData): MentionServerNode =>
	$applyNodeReplacement(new MentionServerNode(data))

export const $isMentionServerNode = (
	node: LexicalNode | null | undefined
): node is MentionServerNode => node instanceof MentionServerNode
