import type { SerializedLexicalNode } from '@payloadcms/richtext-lexical/lexical'

import { WIKI_VIDEO_NODE_TYPE } from '../../editor/constants'
import type { WikiSeedTransformer } from '../types'

const PLACEHOLDER = /^\{\{wiki:(media|video):([\w-]+)\}\}$/

type NodeWithChildren = SerializedLexicalNode & {
	children?: NodeWithChildren[]
	text?: string
}

const placeholderOf = (node: NodeWithChildren): null | RegExpExecArray => {
	if (node.type !== 'paragraph') {
		return null
	}
	const text = (node.children ?? [])
		.map((child) => (typeof child.text === 'string' ? child.text : ''))
		.join('')
		.trim()
	return PLACEHOLDER.exec(text)
}

/**
 * Built-in seed transformer: replaces placeholder paragraphs referencing
 * seeded media by key with real nodes. `{{wiki:media:<key>}}` becomes an
 * upload node, `{{wiki:video:<key>}}` becomes the plugin's video node. An
 * unknown key fails loudly; a silent drop would hide a broken seed.
 */
export const mediaPlaceholdersTransformer: WikiSeedTransformer = (state, context) => {
	const root = state.root as unknown as NodeWithChildren
	root.children = (root.children ?? []).map((node) => {
		const match = placeholderOf(node)
		if (!match) {
			return node
		}
		const [, kind, key] = match
		const media = key === undefined ? undefined : context.media[key]
		if (!media) {
			throw new Error(
				`@10x-media/admin-wiki seed: content references unknown media key "${key ?? ''}"`
			)
		}
		if (kind === 'video') {
			return {
				relationTo: media.relationTo,
				type: WIKI_VIDEO_NODE_TYPE,
				value: media.id,
				version: 1,
			} as unknown as NodeWithChildren
		}
		return {
			fields: null,
			format: '',
			relationTo: media.relationTo,
			type: 'upload',
			value: media.id,
			version: 3,
		} as unknown as NodeWithChildren
	})
	return state
}
