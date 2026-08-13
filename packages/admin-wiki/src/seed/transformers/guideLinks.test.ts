import type { SerializedEditorState } from '@payloadcms/richtext-lexical/lexical'
import { describe, expect, it } from 'vitest'

import { guideLinksTransformer } from './guideLinks'

const paragraphWith = (...children: unknown[]) => ({
	children,
	type: 'paragraph',
	version: 1,
})

const text = (value: string, extra: Record<string, unknown> = {}) => ({
	text: value,
	type: 'text',
	version: 1,
	...extra,
})

const linkTo = (url: string, ...children: unknown[]) => ({
	children,
	fields: { linkType: 'custom', newTab: false, url },
	type: 'link',
	version: 3,
})

const state = (...children: unknown[]): SerializedEditorState =>
	({
		root: { children, direction: null, format: '', indent: 0, type: 'root', version: 1 },
	}) as unknown as SerializedEditorState

const context = {
	guideIdsBySlug: { 'other-guide': 42 },
	guideTitlesBySlug: { 'other-guide': 'The other guide' },
	media: {},
}

const childrenOf = (out: SerializedEditorState, index = 0) =>
	(out.root.children as unknown as Array<{ children: Array<Record<string, unknown>> }>)[index]
		?.children

describe('guideLinksTransformer', () => {
	it('splits text around a bare placeholder and links the guide title', () => {
		const out = guideLinksTransformer(
			state(paragraphWith(text('See {{wiki:guide:other-guide}} for more.'))),
			context
		)
		const children = childrenOf(out)
		expect(children).toHaveLength(3)
		expect(children?.[0]).toMatchObject({ text: 'See ' })
		expect(children?.[1]).toMatchObject({
			children: [{ text: 'The other guide' }],
			guide: 42,
			type: 'wikiGuideLink',
		})
		expect(children?.[2]).toMatchObject({ text: ' for more.' })
	})

	it('keeps the formatting of the run a bare placeholder sat in', () => {
		const out = guideLinksTransformer(
			state(paragraphWith(text('{{wiki:guide:other-guide}}', { format: 1 }))),
			context
		)
		expect(
			(childrenOf(out)?.[0] as { children: Array<{ format: number }> }).children[0]
		).toMatchObject({ format: 1 })
	})

	it('converts a link whose url is a placeholder, keeping the author text', () => {
		const out = guideLinksTransformer(
			state(paragraphWith(linkTo('{{wiki:guide:other-guide}}', text('read this first')))),
			context
		)
		const children = childrenOf(out)
		expect(children).toHaveLength(1)
		expect(children?.[0]).toMatchObject({
			children: [{ text: 'read this first' }],
			guide: 42,
			type: 'wikiGuideLink',
		})
	})

	it('leaves an ordinary link alone', () => {
		const out = guideLinksTransformer(
			state(paragraphWith(linkTo('https://example.com', text('elsewhere')))),
			context
		)
		expect(childrenOf(out)?.[0]).toMatchObject({ type: 'link' })
	})

	it('throws loudly on an unknown guide slug', () => {
		expect(() =>
			guideLinksTransformer(state(paragraphWith(text('{{wiki:guide:missing}}'))), context)
		).toThrow(/unknown guide slug "missing"/)
	})

	it('throws loudly on an unknown slug behind link text', () => {
		expect(() =>
			guideLinksTransformer(
				state(paragraphWith(linkTo('{{wiki:guide:missing}}', text('somewhere')))),
				context
			)
		).toThrow(/unknown guide slug "missing"/)
	})
})
