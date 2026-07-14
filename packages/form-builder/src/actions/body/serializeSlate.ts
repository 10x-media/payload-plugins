import type { BodyRender } from './converters'
import { sanitizeUrl } from './converters'
import { escapeHtml } from './escapeHtml'

type SlateNode = Record<string, unknown>

const leaf = (node: SlateNode, render: BodyRender): string => {
	let html = render.text(typeof node.text === 'string' ? node.text : '')
	if (node.code === true) {
		html = `<code>${html}</code>`
	}
	if (node.bold === true) {
		html = `<strong>${html}</strong>`
	}
	if (node.italic === true) {
		html = `<em>${html}</em>`
	}
	if (node.underline === true) {
		html = `<u>${html}</u>`
	}
	return html
}

const serializeNode = (node: unknown, render: BodyRender): string => {
	if (node == null || typeof node !== 'object') {
		return ''
	}
	const slateNode = node as SlateNode
	if (typeof slateNode.text === 'string') {
		return leaf(slateNode, render)
	}
	const children = Array.isArray(slateNode.children)
		? slateNode.children.map((child) => serializeNode(child, render)).join('')
		: ''
	if (slateNode.type === 'link') {
		const raw = typeof slateNode.url === 'string' ? slateNode.url : ''
		const href = escapeHtml(sanitizeUrl(render.interpolate(raw)))
		return `<a href="${href}">${children}</a>`
	}
	return `<p>${children}</p>`
}

/**
 * Minimal legacy Slate serializer: paragraph-ish elements, bold/italic/underline/code marks, links.
 * Strikethrough is intentionally unsupported for legacy Slate bodies.
 */
export const serializeSlate = (nodes: unknown[], render: BodyRender): string =>
	nodes.map((node) => serializeNode(node, render)).join('')
