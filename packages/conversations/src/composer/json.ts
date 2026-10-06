/**
 * The composer edits the same Lexical JSON the server stores, with one
 * difference: links. The composer uses `@lexical/link` nodes (`url`, `target`,
 * `rel`), while Payload's link feature stores `fields: { url, newTab,
 * linkType }`. These two functions map between them at the edges, so the
 * server, `MessageBody` and stored messages never see the composer's shape.
 */

type JsonNode = { [key: string]: unknown; children?: JsonNode[]; type?: string }

const LINK_TYPES = new Set(['autolink', 'link'])

const mapTree = (body: unknown, map: (node: JsonNode) => JsonNode): unknown => {
	const walk = (node: JsonNode): JsonNode => {
		const mapped = LINK_TYPES.has(node.type ?? '') ? map(node) : node
		return Array.isArray(mapped.children)
			? { ...mapped, children: mapped.children.map(walk) }
			: mapped
	}
	const root = (body as { root?: JsonNode } | null)?.root
	return root ? { ...(body as object), root: walk(root) } : body
}

/** A stored body (Payload's link shape) as composer editor state JSON. */
export const toEditorJSON = (body: unknown): unknown =>
	mapTree(body, (node) => {
		const {
			fields,
			id: _id,
			...rest
		} = node as JsonNode & {
			fields?: { newTab?: boolean; url?: string }
		}
		const newTab = Boolean(fields?.newTab)
		return {
			...rest,
			...(node.type === 'autolink' ? { isUnlinked: false } : {}),
			rel: newTab ? 'noopener noreferrer' : null,
			target: newTab ? '_blank' : null,
			title: null,
			url: fields?.url ?? '',
			version: 1,
		}
	})

/** Composer editor state JSON as a body the server stores (Payload's link shape). */
export const toStoredJSON = (state: unknown): unknown =>
	mapTree(state, (node) => {
		const {
			isUnlinked: _unlinked,
			rel: _rel,
			target,
			title: _title,
			url,
			...rest
		} = node as JsonNode & {
			isUnlinked?: boolean
			rel?: unknown
			target?: unknown
			title?: unknown
			url?: string
		}
		return {
			...rest,
			fields: { linkType: 'custom', newTab: target === '_blank', url: url ?? '' },
			version: node.type === 'autolink' ? 2 : 3,
		}
	})

/** Whether a body holds anything worth sending: text that is not blank, or a mention. */
export const hasContent = (body: unknown): boolean => {
	const walk = (node: unknown): boolean => {
		if (!node || typeof node !== 'object') return false
		const record = node as { children?: unknown[]; text?: unknown; type?: unknown }
		if (typeof record.text === 'string' && record.text.trim().length > 0) return true
		if (record.type === 'conversationsMention') return true
		return Array.isArray(record.children) && record.children.some(walk)
	}
	return walk((body as { root?: unknown } | null)?.root)
}
