import type { WikiSeedTransformer } from '../../src/index'

type LooseNode = {
	children?: LooseNode[]
	text?: string
	type?: string
	[key: string]: unknown
}

const blockId = (): string => crypto.randomUUID().replace(/-/g, '').slice(0, 24)

const paragraphText = (node: LooseNode): null | string => {
	if (node.type !== 'paragraph') {
		return null
	}
	return (node.children ?? [])
		.map((child) => (typeof child.text === 'string' ? child.text : ''))
		.join('')
		.trim()
}

/**
 * Consumer transformer demo: a paragraph starting with `:::tip ` becomes the
 * dev app's own `devTip` wiki editor block, proving the seed pipeline's
 * extension point end to end (block authored, seeded, and rendered).
 */
export const devTipTransformer: WikiSeedTransformer = (state) => {
	const root = state.root as unknown as LooseNode
	root.children = (root.children ?? []).map((node) => {
		const text = paragraphText(node)
		if (!text?.startsWith(':::tip ')) {
			return node
		}
		return {
			fields: { blockType: 'devTip', id: blockId(), tip: text.slice(':::tip '.length) },
			format: '',
			type: 'block',
			version: 2,
		} as LooseNode
	})
	return state
}

/**
 * Consumer transformer demo: a paragraph of the form `{{embed:<url>}}` becomes
 * the plugin's external video embed block.
 */
export const embedTransformer: WikiSeedTransformer = (state) => {
	const root = state.root as unknown as LooseNode
	root.children = (root.children ?? []).map((node) => {
		const text = paragraphText(node)
		const match = text ? /^\{\{embed:(.+)\}\}$/.exec(text) : null
		if (!match) {
			return node
		}
		return {
			fields: { blockType: 'wikiVideoEmbed', id: blockId(), url: match[1] },
			format: '',
			type: 'block',
			version: 2,
		} as LooseNode
	})
	return state
}

/**
 * Consumer transformer demo: `{{chip:tone:label}}` inside a paragraph becomes
 * the dev app's own `devStatusChip` inline block, so the seeded content carries
 * an inline node the same way it carries block ones.
 */
export const statusChipTransformer: WikiSeedTransformer = (state) => {
	const root = state.root as unknown as LooseNode
	for (const node of root.children ?? []) {
		if (node.type !== 'paragraph') {
			continue
		}
		node.children = (node.children ?? []).flatMap((child) => {
			const text = typeof child.text === 'string' ? child.text : null
			if (!text?.includes('{{chip:')) {
				return [child]
			}
			// Split on the placeholder so the surrounding words stay text nodes and
			// the chip lands between them, which is the point of an inline block.
			return text.split(/(\{\{chip:[^:}]+:[^}]+\}\})/).flatMap((part): LooseNode[] => {
				const match = /^\{\{chip:([^:}]+):([^}]+)\}\}$/.exec(part)
				if (match) {
					return [
						{
							fields: {
								blockType: 'devStatusChip',
								id: blockId(),
								label: match[2],
								tone: match[1],
							},
							type: 'inlineBlock',
							version: 1,
						} as LooseNode,
					]
				}
				return part ? [{ ...child, text: part }] : []
			})
		})
	}
	return state
}
