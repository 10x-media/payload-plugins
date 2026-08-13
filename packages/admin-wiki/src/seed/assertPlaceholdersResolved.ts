import type {
	SerializedEditorState,
	SerializedLexicalNode,
} from '@payloadcms/richtext-lexical/lexical'

/** Any placeholder in the namespace the plugin owns, wherever it survived. */
const PLACEHOLDER = /\{\{wiki:(?:guide|media|video):[^}]*\}\}/

/** Lexical's `IS_CODE` text format bit; inline code is prose about the syntax. */
const IS_CODE = 1 << 4

type SeedNode = SerializedLexicalNode & {
	children?: SeedNode[]
	fields?: Record<string, unknown>
	format?: unknown
	text?: string
}

const leftoverIn = (node: SeedNode): null | string => {
	if (
		typeof node.text === 'string' &&
		!(typeof node.format === 'number' && node.format & IS_CODE)
	) {
		const found = PLACEHOLDER.exec(node.text)
		if (found) {
			return found[0]
		}
	}
	const url = node.fields?.url
	if (typeof url === 'string') {
		const found = PLACEHOLDER.exec(url)
		if (found) {
			return found[0]
		}
	}
	for (const value of Object.values(node.fields ?? {})) {
		const root = (value as { root?: unknown } | null)?.root
		if (root && typeof root === 'object') {
			const nested = leftoverIn(root as SeedNode)
			if (nested) {
				return nested
			}
		}
	}
	for (const child of node.children ?? []) {
		const nested = leftoverIn(child)
		if (nested) {
			return nested
		}
	}
	return null
}

/**
 * Fail a seed run that left one of the plugin's own placeholders behind rather
 * than writing it into a guide, where it reads as literal `{{wiki:...}}` text,
 * or, for the `[words]({{wiki:guide:slug}})` form, as an ordinary link pointing
 * at a URL that goes nowhere.
 *
 * That happens whenever a placeholder ends up somewhere the transformers do not
 * reach: a consumer block created by a transformer that runs after them, or a
 * media placeholder inside a callout, where an upload node cannot go. Silence
 * there is the worst outcome, because the guide still saves and only reads
 * wrong. Inline code is exempt: a guide explaining the placeholder syntax is
 * spelling it, not using it.
 */
export const assertPlaceholdersResolved = (state: SerializedEditorState, label: string): void => {
	const leftover = leftoverIn(state.root as unknown as SeedNode)
	if (leftover !== null) {
		throw new Error(
			`@10x-media/admin-wiki seed: "${label}" still holds the placeholder ${leftover} after every transformer ran. ` +
				'Placeholders are only rewritten in guide content the built-in transformers walk; ' +
				'a consumer transformer that creates the node holding it has to run before them, ' +
				'and `{{wiki:media:...}}` has to stand alone in a paragraph.'
		)
	}
}
