import {
	$applyNodeReplacement,
	DecoratorNode,
	type LexicalNode,
	type SerializedLexicalNode,
	type Spread,
} from '@payloadcms/richtext-lexical/lexical'
import type * as React from 'react'

import { WIKI_VIDEO_NODE_TYPE } from '../constants'

/** What a wiki video node stores: a reference to one wiki-media document. */
export type WikiVideoData = {
	relationTo: string
	value: number | string
}

export type SerializedWikiVideoNode = Spread<WikiVideoData, SerializedLexicalNode>

/**
 * Server-side DecoratorNode for an uploaded video, copying the shape of the
 * built-in HorizontalRule feature. The client subclass overrides `decorate`
 * to render the inline player; here it stays inert.
 */
export class WikiVideoServerNode extends DecoratorNode<null | React.ReactElement> {
	__data: WikiVideoData

	constructor(data: WikiVideoData, key?: string) {
		super(key)
		this.__data = data
	}

	static override clone(node: WikiVideoServerNode): WikiVideoServerNode {
		return new this(node.__data, node.__key)
	}

	static override getType(): string {
		return WIKI_VIDEO_NODE_TYPE
	}

	static override importJSON(serializedNode: SerializedWikiVideoNode): WikiVideoServerNode {
		return $createWikiVideoServerNode({
			relationTo: serializedNode.relationTo,
			value: serializedNode.value,
		})
	}

	/**
	 * The host element Lexical mounts `decorate` into, and the styled card block:
	 * the client view renders its contents straight into this, with no wrapper of
	 * its own, so there is exactly one bordered card per node.
	 */
	override createDOM(): HTMLElement {
		const element = document.createElement('div')
		element.className = 'wiki-video-node'
		return element
	}

	override decorate(): null | React.ReactElement {
		return null
	}

	override exportJSON(): SerializedWikiVideoNode {
		return {
			...this.getData(),
			type: WIKI_VIDEO_NODE_TYPE,
			version: 1,
		}
	}

	getData(): WikiVideoData {
		return this.getLatest().__data
	}

	override getTextContent(): string {
		return '\n'
	}

	override isInline(): false {
		return false
	}

	override updateDOM(): boolean {
		return false
	}
}

export function $createWikiVideoServerNode(data: WikiVideoData): WikiVideoServerNode {
	return $applyNodeReplacement(new WikiVideoServerNode(data))
}

export function $isWikiVideoServerNode(
	node: LexicalNode | null | undefined
): node is WikiVideoServerNode {
	return node instanceof WikiVideoServerNode
}
