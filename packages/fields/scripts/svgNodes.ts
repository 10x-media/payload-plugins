import { JSDOM } from 'jsdom'
import type { IconNode } from '../src/types'

/** Root attributes describe the canvas, which a layer declares once, not per glyph. */
const ROOT_ONLY = new Set(['class', 'fill', 'height', 'stroke', 'viewBox', 'width', 'xmlns'])

/**
 * React expects SVG presentation attributes camelCased (`fillRule`, not `fill-rule`), and
 * warns on the hyphenated form. `data-` and `aria-` stay as written, which is what React
 * expects for those.
 */
const reactAttributeName = (name: string): string => {
	if (name.startsWith('data-') || name.startsWith('aria-')) return name
	return name.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase())
}

const toNodes = (element: Element): IconNode[] => {
	const nodes: IconNode[] = []
	for (const child of Array.from(element.children)) {
		const attrs: Record<string, string> = {}
		for (const attribute of Array.from(child.attributes)) {
			attrs[reactAttributeName(attribute.name)] = attribute.value
		}
		const grandchildren = toNodes(child)
		nodes.push(
			grandchildren.length > 0 ? [child.tagName, attrs, grandchildren] : [child.tagName, attrs]
		)
	}
	return nodes
}

export type ParsedSvg = { canvas: { fill?: string; viewBox?: string }; nodes: IconNode[] }

/**
 * Parses rendered SVG markup into the drawer's node shape, so a library shipping React
 * components can still feed the bulk fast path. Reads the root's own attributes off as
 * canvas rather than repeating them on every glyph.
 */
export const parseSvgMarkup = (markup: string): ParsedSvg => {
	const { window } = new JSDOM(markup, { contentType: 'image/svg+xml' })
	const root = window.document.querySelector('svg')
	if (!root) throw new Error(`not an svg: ${markup.slice(0, 80)}`)
	const canvas: ParsedSvg['canvas'] = {}
	const viewBox = root.getAttribute('viewBox')
	const fill = root.getAttribute('fill')
	if (viewBox !== null) canvas.viewBox = viewBox
	if (fill !== null) canvas.fill = fill
	for (const attribute of Array.from(root.attributes)) {
		if (!ROOT_ONLY.has(attribute.name)) {
			throw new Error(`unexpected root attribute "${attribute.name}" on an icon svg`)
		}
	}
	return { canvas, nodes: toNodes(root) }
}
