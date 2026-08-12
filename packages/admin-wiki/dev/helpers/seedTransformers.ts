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
