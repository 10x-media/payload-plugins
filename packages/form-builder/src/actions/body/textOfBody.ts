type BodyNode = Record<string, unknown>

const isNode = (value: unknown): value is BodyNode =>
	value != null && typeof value === 'object' && !Array.isArray(value)

/** Children-bearing block-level node types whose text reads as a separate run. */
const BLOCK_TYPES = new Set(['paragraph', 'heading', 'listitem', 'quote'])

const textOfNode = (node: unknown): string => {
	if (!isNode(node)) {
		return ''
	}
	if (typeof node.text === 'string') {
		return node.text
	}
	const children = Array.isArray(node.children) ? node.children.map(textOfNode).join('') : ''
	if (children !== '' && typeof node.type === 'string' && BLOCK_TYPES.has(node.type)) {
		return ` ${children} `
	}
	return children
}

/**
 * Plain-text content of a body (Lexical rich text, legacy Slate, or a legacy string): leaf text
 * nodes concatenated in document order, block-level nodes (paragraph, heading, list item, quote)
 * joined by single spaces, whitespace collapsed, so multi-block content flattens to a readable
 * sentence. For accessible names and previews, where formatting and links collapse to their
 * visible words. A plain string passes through untouched; unrecognized shapes yield `''`;
 * never throws.
 */
export const textOfBody = (body: unknown): string => {
	if (typeof body === 'string') {
		return body
	}
	const root = isNode(body) ? body.root : undefined
	const nodes = Array.isArray(body)
		? body
		: isNode(root) && Array.isArray(root.children)
			? root.children
			: null
	if (!nodes) {
		return ''
	}
	return nodes.map(textOfNode).join('').replace(/\s+/g, ' ').trim()
}
