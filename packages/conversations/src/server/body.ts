import { convertLexicalToPlaintext } from '@payloadcms/richtext-lexical/plaintext'

import { MENTION_NODE_TYPE } from '../editor/mention/constants'

type Node = { [key: string]: unknown; children?: unknown; type?: unknown }

/** A serialized Lexical editor state, loosely typed: bodies arrive from clients. */
export type LexicalBody = { root: Node & { children: Node[] } }

export const isLexicalBody = (value: unknown): value is LexicalBody =>
	typeof value === 'object' &&
	value !== null &&
	'root' in value &&
	typeof (value as { root: unknown }).root === 'object' &&
	(value as { root: unknown }).root !== null &&
	Array.isArray((value as { root: { children?: unknown } }).root.children)

const textNode = (text: string) => ({
	detail: 0,
	format: 0,
	mode: 'normal',
	style: '',
	text,
	type: 'text',
	version: 1,
})

/** Wrap plain text into a one-paragraph body; line breaks become linebreak nodes. */
export const textToBody = (text: string): LexicalBody => {
	const children: Node[] = []
	text.split(/\r?\n/).forEach((line, index) => {
		if (index > 0) {
			children.push({ type: 'linebreak', version: 1 })
		}
		if (line.length > 0) {
			children.push(textNode(line))
		}
	})
	return {
		root: {
			children: [
				{
					children,
					direction: 'ltr',
					format: '',
					indent: 0,
					textFormat: 0,
					type: 'paragraph',
					version: 1,
				},
			],
			direction: 'ltr',
			format: '',
			indent: 0,
			type: 'root',
			version: 1,
		},
	}
}

const walk = (node: Node, visit: (node: Node) => void): void => {
	visit(node)
	if (Array.isArray(node.children)) {
		for (const child of node.children as Node[]) {
			if (typeof child === 'object' && child !== null) {
				walk(child, visit)
			}
		}
	}
}

/** The plain-text projection stored as `text`: mentions read as `@Name`. */
export const bodyToText = (body: LexicalBody): string =>
	convertLexicalToPlaintext({
		converters: {
			[MENTION_NODE_TYPE]: ({ node }: { node: { label?: unknown } }) =>
				`@${typeof node.label === 'string' ? node.label : ''}`,
		},
		data: body as never,
	}).trim()

/** Every mentioned user key, in document order, without duplicates. */
export const extractMentions = (body: LexicalBody): string[] => {
	const found: string[] = []
	walk(body.root, (node) => {
		if (node.type === MENTION_NODE_TYPE && typeof node.userKey === 'string') {
			if (!found.includes(node.userKey)) {
				found.push(node.userKey)
			}
		}
	})
	return found
}

const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'mailto:'])

/** Link URLs whose scheme is not http, https or mailto. */
export const disallowedLinks = (body: LexicalBody): string[] => {
	const bad: string[] = []
	walk(body.root, (node) => {
		if (node.type !== 'link' && node.type !== 'autolink') {
			return
		}
		const fields = node.fields as { url?: unknown } | undefined
		const url = typeof fields?.url === 'string' ? fields.url.trim() : ''
		const match = /^([a-z][a-z0-9+.-]*):/i.exec(url)
		if (!match || !ALLOWED_SCHEMES.has(`${match[1]?.toLowerCase()}:`)) {
			bad.push(url)
		}
	})
	return bad
}
