import type {
	BaseSelection,
	DOMConversionMap,
	DOMConversionOutput,
	EditorConfig,
	ElementNode as ElementNodeType,
	LexicalCommand,
	LexicalNode,
	LexicalUpdateJSON,
	NodeKey,
	RangeSelection,
	SerializedElementNode,
	Spread,
} from '@payloadcms/richtext-lexical/lexical'
import {
	$applyNodeReplacement,
	$getSelection,
	$isElementNode,
	$isRangeSelection,
	createCommand,
	ElementNode,
} from '@payloadcms/richtext-lexical/lexical'
import { addClassNamesToElement } from '@payloadcms/richtext-lexical/lexical/utils'

import { WIKI_GUIDE_LINK_NODE_TYPE } from '../constants'

/** The guide a link points at, as the stored document id. */
export type WikiGuideLinkTarget = null | number | string

export type SerializedWikiGuideLinkNode = Spread<
	{ guide: WikiGuideLinkTarget; type: typeof WIKI_GUIDE_LINK_NODE_TYPE },
	SerializedElementNode
>

/**
 * An inline element node whose children are the link text, the way Lexical's own
 * `LinkNode` works. Two things follow from that and neither did from the inline
 * block this replaces: the words under the link are real content, so an author
 * writes and edits them in place and the seed can supply them, and a guide link
 * inside a sentence stops being an opaque chip in the middle of it.
 *
 * The target is a bare document id rather than a `{ relationTo, value }` pair:
 * a guide link always points at the wiki pages collection, and the reader
 * resolves the id through the provider's per-session guide cache rather than
 * through population, so nothing here needs an `afterRead` hook.
 */
export class WikiGuideLinkNode extends ElementNode {
	__guide: WikiGuideLinkTarget

	constructor({ guide = null, key }: { guide?: WikiGuideLinkTarget; key?: NodeKey } = {}) {
		super(key)
		this.__guide = guide
	}

	static override clone(node: WikiGuideLinkNode): WikiGuideLinkNode {
		return new this({ guide: node.__guide, key: node.__key })
	}

	static override getType(): string {
		return WIKI_GUIDE_LINK_NODE_TYPE
	}

	static override importDOM(): DOMConversionMap | null {
		return {
			span: (domNode: HTMLElement) =>
				domNode.hasAttribute('data-wiki-guide')
					? { conversion: $convertWikiGuideLinkElement, priority: 2 }
					: null,
		}
	}

	static override importJSON(serializedNode: SerializedWikiGuideLinkNode): WikiGuideLinkNode {
		return $createWikiGuideLinkNode().updateFromJSON(serializedNode)
	}

	/** A link with no text is not a link; Lexical removes it rather than keeping an empty one. */
	override canBeEmpty(): false {
		return false
	}

	/** Typing at either edge continues the sentence, not the link. */
	override canInsertTextAfter(): false {
		return false
	}

	override canInsertTextBefore(): false {
		return false
	}

	override createDOM(config: EditorConfig): HTMLSpanElement {
		const element = document.createElement('span')
		setGuideAttribute(element, this.__guide)
		addClassNamesToElement(element, config.theme.wikiGuideLink ?? 'wiki-guide-link-node')
		return element
	}

	override exportJSON(): SerializedWikiGuideLinkNode {
		return {
			...super.exportJSON(),
			guide: this.getGuide(),
			type: WIKI_GUIDE_LINK_NODE_TYPE,
			version: 1,
		}
	}

	/**
	 * Copying part of a link copies the words, not the link: only a selection that
	 * lies wholly inside this node carries the node itself along.
	 */
	override extractWithChild(
		_child: LexicalNode,
		selection: BaseSelection,
		_destination: 'clone' | 'html'
	): boolean {
		if (!$isRangeSelection(selection)) {
			return false
		}
		return (
			this.isParentOf(selection.anchor.getNode()) &&
			this.isParentOf(selection.focus.getNode()) &&
			selection.getTextContent().length > 0
		)
	}

	getGuide(): WikiGuideLinkTarget {
		return this.getLatest().__guide
	}

	/** Enter inside a link continues the link on the next block, as `LinkNode` does. */
	override insertNewAfter(
		selection: RangeSelection,
		restoreSelection = true
	): ElementNodeType | null {
		const element = this.getParentOrThrow().insertNewAfter(selection, restoreSelection)
		if (!$isElementNode(element)) {
			return null
		}
		const node = $createWikiGuideLinkNode({ guide: this.__guide })
		element.append(node)
		return node
	}

	override isInline(): true {
		return true
	}

	setGuide(guide: WikiGuideLinkTarget): this {
		const writable = this.getWritable()
		writable.__guide = guide
		return writable
	}

	override updateDOM(prevNode: this, element: HTMLSpanElement): boolean {
		if (prevNode.__guide !== this.__guide) {
			setGuideAttribute(element, this.__guide)
		}
		return false
	}

	override updateFromJSON(serializedNode: LexicalUpdateJSON<SerializedWikiGuideLinkNode>): this {
		return super.updateFromJSON(serializedNode).setGuide(serializedNode.guide ?? null)
	}
}

const setGuideAttribute = (element: HTMLSpanElement, guide: WikiGuideLinkTarget): void => {
	if (guide === null) {
		element.removeAttribute('data-wiki-guide')
		return
	}
	element.setAttribute('data-wiki-guide', String(guide))
}

const $convertWikiGuideLinkElement = (domNode: HTMLElement): DOMConversionOutput => {
	const guide = domNode.getAttribute('data-wiki-guide')
	return { node: guide ? $createWikiGuideLinkNode({ guide }) : null }
}

export const $createWikiGuideLinkNode = ({
	guide = null,
}: {
	guide?: WikiGuideLinkTarget
} = {}): WikiGuideLinkNode => $applyNodeReplacement(new WikiGuideLinkNode({ guide }))

export const $isWikiGuideLinkNode = (
	node: LexicalNode | null | undefined
): node is WikiGuideLinkNode => node instanceof WikiGuideLinkNode

export type ToggleWikiGuideLinkPayload = {
	guide: number | string
	/**
	 * The nodes to wrap, captured before the guide picker took focus. Lexical's
	 * selection does not survive a drawer, so the toggle is handed the nodes
	 * rather than asked to read them back.
	 */
	nodes?: LexicalNode[]
}

/** Wrap the selection in a guide link, retarget the one it is already in, or (`null`) unwrap it. */
export const TOGGLE_WIKI_GUIDE_LINK_COMMAND: LexicalCommand<null | ToggleWikiGuideLinkPayload> =
	createCommand('TOGGLE_WIKI_GUIDE_LINK_COMMAND')

const $guideLinkAncestor = (node: LexicalNode): null | WikiGuideLinkNode => {
	let parent: LexicalNode | null = node
	while (parent !== null) {
		parent = parent.getParent()
		if (parent === null || $isWikiGuideLinkNode(parent)) {
			break
		}
	}
	return $isWikiGuideLinkNode(parent) ? parent : null
}

/**
 * Ported from Lexical's `$toggleLink`, which is the algorithm this needs and is
 * not exported in a form a foreign node type can reuse: it creates `LinkNode`
 * throughout. The shape is kept close to the original so the next person to read
 * the two side by side can see that only the node type differs.
 */
export const $toggleWikiGuideLink = (payload: null | ToggleWikiGuideLinkPayload): void => {
	const selection = $getSelection()
	if (!$isRangeSelection(selection) && !payload?.nodes?.length) {
		return
	}
	// Captured nodes win over the live selection: the guide picker is a drawer, and
	// whether Lexical still holds the author's range by the time it closes is not
	// something to depend on. `extract()` also splits text nodes, which would leave
	// the drawer's restored selection pointing past the end of one.
	const nodes = payload?.nodes?.length
		? payload.nodes
		: $isRangeSelection(selection)
			? selection.extract()
			: []

	if (payload === null) {
		for (const node of nodes) {
			const parent = node.getParent()
			if (!$isWikiGuideLinkNode(parent)) {
				continue
			}
			for (const child of parent.getChildren()) {
				parent.insertBefore(child)
			}
			parent.remove()
		}
		return
	}

	// A single node already inside a link is a retarget, not a new wrap.
	const only = nodes.length === 1 ? nodes[0] : undefined
	if (only) {
		const existing = $isWikiGuideLinkNode(only) ? only : $guideLinkAncestor(only)
		if (existing !== null) {
			existing.setGuide(payload.guide)
			return
		}
	}

	let prevParent: ElementNodeType | null | WikiGuideLinkNode = null
	let linkNode: null | WikiGuideLinkNode = null

	for (const node of nodes) {
		const parent = node.getParent()
		if (parent === linkNode || parent === null || ($isElementNode(node) && !node.isInline())) {
			continue
		}
		if ($isWikiGuideLinkNode(parent)) {
			linkNode = parent
			parent.setGuide(payload.guide)
			continue
		}
		if (!parent.is(prevParent)) {
			prevParent = parent
			linkNode = $createWikiGuideLinkNode({ guide: payload.guide })
			node.insertBefore(linkNode)
		}
		if ($isWikiGuideLinkNode(node)) {
			if (node.is(linkNode)) {
				continue
			}
			linkNode?.append(...node.getChildren())
			node.remove()
			continue
		}
		linkNode?.append(node)
	}
}
