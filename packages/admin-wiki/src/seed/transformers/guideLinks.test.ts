import type { SerializedEditorState } from '@payloadcms/richtext-lexical/lexical'
import { describe, expect, it } from 'vitest'

import { guideLinksTransformer } from './guideLinks'

const paragraphWith = (value: string) => ({
	children: [{ text: value, type: 'text', version: 1 }],
	type: 'paragraph',
	version: 1,
})

const state = (...children: unknown[]): SerializedEditorState =>
	({
		root: { children, direction: null, format: '', indent: 0, type: 'root', version: 1 },
	}) as unknown as SerializedEditorState

const context = { guideIdsBySlug: { 'other-guide': 42 }, media: {} }

describe('guideLinksTransformer', () => {
	it('splits text around the placeholder and inserts a guide-link inline block', () => {
		const out = guideLinksTransformer(
			state(paragraphWith('See {{wiki:guide:other-guide}} for more.')),
			context
		)
		const paragraph = (
			out.root.children as unknown as Array<{ children: Array<Record<string, unknown>> }>
		)[0]
		expect(paragraph?.children).toHaveLength(3)
		expect(paragraph?.children[0]).toMatchObject({ text: 'See ' })
		expect(paragraph?.children[1]).toMatchObject({
			fields: { blockType: 'wikiGuideLink', guide: 42 },
			type: 'inlineBlock',
		})
		expect(paragraph?.children[2]).toMatchObject({ text: ' for more.' })
	})

	it('throws loudly on an unknown guide slug', () => {
		expect(() =>
			guideLinksTransformer(state(paragraphWith('{{wiki:guide:missing}}')), context)
		).toThrow(/unknown guide slug "missing"/)
	})
})
