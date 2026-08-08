/**
 * Heading extraction for the table of contents. Lexical stores no ids on
 * headings, so both the renderer and the TOC derive them here from the same
 * deterministic walk: the renderer to stamp `id` onto the rendered element, the
 * TOC to link to it. Server-safe and client-safe.
 */

import { slugify } from './slugify'

export type WikiHeading = {
	id: string
	/** 1 for `h1` through 6 for `h6`. */
	level: number
	text: string
}

export type GuideHeadings = {
	headings: WikiHeading[]
	/**
	 * Id per heading node, keyed by the node object itself rather than by its
	 * position, so the renderer stays correct no matter how often React re-runs
	 * a converter.
	 */
	idsByNode: Map<object, string>
}

/** Below this, a table of contents is noise rather than navigation. */
export const MIN_TOC_HEADINGS = 3

type LexicalNode = {
	children?: unknown
	tag?: unknown
	text?: unknown
	type?: unknown
}

const HEADING_LEVELS: Record<string, number> = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 }

/** The text a heading reads as, including any text nested in links or formats. */
const textOf = (node: LexicalNode): string => {
	if (typeof node.text === 'string') {
		return node.text
	}
	if (!Array.isArray(node.children)) {
		return ''
	}
	return node.children.map((child) => textOf(child as LexicalNode)).join('')
}

/**
 * Walk the document depth-first, exactly as the JSX converters do, assigning
 * every heading a slug of its own text. Repeated headings get a numeric suffix,
 * so ids stay unique within one guide. Block fields hold their own editor
 * states rather than `children`, so nested editors (a callout body, for
 * instance) are naturally out of scope: they render through their own
 * `RichText` and never reach this converter.
 */
export const collectGuideHeadings = (data: unknown): GuideHeadings => {
	const headings: WikiHeading[] = []
	const idsByNode = new Map<object, string>()
	const used = new Map<string, number>()

	const visit = (node: LexicalNode): void => {
		if (node.type === 'heading') {
			const text = textOf(node).trim()
			const base = slugify(text) || 'section'
			const seen = used.get(base) ?? 0
			used.set(base, seen + 1)
			const id = seen === 0 ? base : `${base}-${seen + 1}`
			idsByNode.set(node as object, id)
			headings.push({ id, level: HEADING_LEVELS[String(node.tag)] ?? 0, text })
			return
		}
		if (Array.isArray(node.children)) {
			for (const child of node.children) {
				visit(child as LexicalNode)
			}
		}
	}

	const root = (data as null | { root?: LexicalNode })?.root
	if (root && Array.isArray(root.children)) {
		for (const child of root.children) {
			visit(child as LexicalNode)
		}
	}
	return { headings, idsByNode }
}

/**
 * The headings a table of contents lists. `h4` and below are excluded: they
 * make the list longer than the section it describes, and `h1` is excluded
 * because both the drawer and the view already print the guide title.
 */
export const tocHeadings = (headings: WikiHeading[]): WikiHeading[] =>
	headings.filter((heading) => heading.level === 2 || heading.level === 3)

/** Whether a guide has enough structure to be worth a table of contents. */
export const hasTocHeadings = (headings: WikiHeading[]): boolean =>
	tocHeadings(headings).length >= MIN_TOC_HEADINGS
