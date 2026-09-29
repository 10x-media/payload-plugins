import {
	$applyNodeReplacement,
	DecoratorNode,
	type LexicalNode,
	type NodeKey,
} from '@payloadcms/richtext-lexical/lexical'
import type * as React from 'react'

import {
	type SerializedTokenNode,
	TEXT_FORMAT_BITS,
	TOKEN_NODE_TYPE,
	type TokenData,
	type TokenTextFormat,
	tokenDataOf,
} from './types'

/**
 * An inline, atomic reference to a lock window value. It carries a text format
 * of its own, so bold or italic reach it like the text around it. The server
 * half stays inert; the client subclass decorates it with the chip.
 */
export class ContentLockTokenServerNode extends DecoratorNode<null | React.ReactElement> {
	__data: TokenData

	constructor(data: TokenData, key?: NodeKey) {
		super(key)
		this.__data = data
	}

	static override clone(node: ContentLockTokenServerNode): ContentLockTokenServerNode {
		return new this(node.__data, node.__key)
	}

	static override getType(): string {
		return TOKEN_NODE_TYPE
	}

	static override importJSON(serializedNode: SerializedTokenNode): ContentLockTokenServerNode {
		return $applyNodeReplacement(new ContentLockTokenServerNode(tokenDataOf(serializedNode)))
	}

	override createDOM(): HTMLElement {
		const element = document.createElement('span')
		element.className = 'content-lock-token-host'
		return element
	}

	override updateDOM(): boolean {
		return false
	}

	override decorate(): null | React.ReactElement {
		return null
	}

	override exportJSON(): SerializedTokenNode {
		return { ...this.getData(), type: TOKEN_NODE_TYPE, version: 1 }
	}

	override isInline(): true {
		return true
	}

	override getTextContent(): string {
		return `{${this.__data.token}}`
	}

	getData(): TokenData {
		return this.getLatest().__data
	}

	setData(data: TokenData): void {
		this.getWritable().__data = data
	}

	hasTextFormat(type: TokenTextFormat): boolean {
		return (this.getData().textFormat & TEXT_FORMAT_BITS[type]) !== 0
	}

	setTextFormat(type: TokenTextFormat, on: boolean): void {
		const data = this.getData()
		const bit = TEXT_FORMAT_BITS[type]
		this.setData({ ...data, textFormat: on ? data.textFormat | bit : data.textFormat & ~bit })
	}
}

export function $isContentLockTokenNode(
	node: LexicalNode | null | undefined
): node is ContentLockTokenServerNode {
	return node instanceof ContentLockTokenServerNode
}
