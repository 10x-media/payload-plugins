import { escapeHtml } from './escapeHtml'

/** Text pipelines a converter can apply to author-typed content. */
export type BodyRender = {
	/** Full text pipeline: HTML-escape, then expand `{{*}}`/`{{*:table}}` and recall tokens with escaped values. */
	text: (raw: string) => string
	/** Recall-token interpolation only, unescaped; for URL-like values that get escaped separately. */
	interpolate: (raw: string) => string
}

export type BodyConverterArgs = {
	node: Record<string, unknown>
	/** The node's already-serialized children. */
	children: string
	render: BodyRender
}

/** Serializes one Lexical node type to an HTML string. Keyed by `node.type` in the registry. */
export type BodyConverter = (args: BodyConverterArgs) => string

const SCHEME = /^[a-z][a-z0-9+.-]*:/i
const SAFE_SCHEME = /^(https?|mailto|tel):/i

/** Allow http(s)/mailto/tel and scheme-less (relative) URLs; anything else becomes `#`. */
export const sanitizeUrl = (url: string): string => {
	const probe = url.replace(/\s/g, '')
	if (probe === '') {
		return '#'
	}
	if (SCHEME.test(probe)) {
		return SAFE_SCHEME.test(probe) ? url.trim() : '#'
	}
	return url.trim()
}

const BOLD = 1
const ITALIC = 2
const STRIKETHROUGH = 4
const UNDERLINE = 8
const CODE = 16

const text: BodyConverter = ({ node, render }) => {
	let html = render.text(typeof node.text === 'string' ? node.text : '')
	const format = typeof node.format === 'number' ? node.format : 0
	if (format & CODE) {
		html = `<code>${html}</code>`
	}
	if (format & BOLD) {
		html = `<strong>${html}</strong>`
	}
	if (format & ITALIC) {
		html = `<em>${html}</em>`
	}
	if (format & STRIKETHROUGH) {
		html = `<s>${html}</s>`
	}
	if (format & UNDERLINE) {
		html = `<u>${html}</u>`
	}
	return html
}

const link: BodyConverter = ({ node, children, render }) => {
	const fields = (node.fields ?? {}) as Record<string, unknown>
	const raw =
		typeof fields.url === 'string' ? fields.url : typeof node.url === 'string' ? node.url : ''
	const href = escapeHtml(sanitizeUrl(render.interpolate(raw)))
	const newTab = fields.newTab === true
	return `<a href="${href}"${newTab ? ' rel="noopener noreferrer" target="_blank"' : ''}>${children}</a>`
}

const HEADING_TAG = /^h[1-6]$/

const heading: BodyConverter = ({ node, children }) => {
	const tag = typeof node.tag === 'string' && HEADING_TAG.test(node.tag) ? node.tag : 'h2'
	return `<${tag}>${children}</${tag}>`
}

const list: BodyConverter = ({ node, children }) => {
	const tag = node.tag === 'ol' || node.listType === 'number' ? 'ol' : 'ul'
	return `<${tag}>${children}</${tag}>`
}

/** Default Lexical-to-HTML converter registry; consumers spread overrides per node type. */
export const defaultBodyConverters: Record<string, BodyConverter> = {
	autolink: link,
	heading,
	horizontalrule: () => '<hr />',
	linebreak: () => '<br />',
	link,
	list,
	listitem: ({ children }) => `<li>${children}</li>`,
	paragraph: ({ children }) => `<p>${children}</p>`,
	quote: ({ children }) => `<blockquote>${children}</blockquote>`,
	text,
}
