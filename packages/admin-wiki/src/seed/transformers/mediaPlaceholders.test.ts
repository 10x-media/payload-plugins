import type { SerializedEditorState } from '@payloadcms/richtext-lexical/lexical'
import { describe, expect, it } from 'vitest'

import { mediaPlaceholdersTransformer } from './mediaPlaceholders'

const paragraphWith = (value: string) => ({
	children: [{ text: value, type: 'text', version: 1 }],
	type: 'paragraph',
	version: 1,
})

const state = (...children: unknown[]): SerializedEditorState =>
	({
		root: { children, direction: null, format: '', indent: 0, type: 'root', version: 1 },
	}) as unknown as SerializedEditorState

const context = {
	guideIdsBySlug: {},
	guideTitlesBySlug: {},
	media: { demo: { id: 7, relationTo: 'wiki-media' } },
}

describe('mediaPlaceholdersTransformer', () => {
	it('replaces media placeholders with upload nodes', () => {
		const out = mediaPlaceholdersTransformer(state(paragraphWith('{{wiki:media:demo}}')), context)
		expect((out.root.children as Array<Record<string, unknown>>)[0]).toMatchObject({
			relationTo: 'wiki-media',
			type: 'upload',
			value: 7,
		})
	})

	it('replaces video placeholders with wiki video nodes', () => {
		const out = mediaPlaceholdersTransformer(state(paragraphWith('{{wiki:video:demo}}')), context)
		expect((out.root.children as Array<Record<string, unknown>>)[0]).toMatchObject({
			relationTo: 'wiki-media',
			type: 'wikiVideo',
			value: 7,
		})
	})

	it('throws loudly on an unknown key and leaves other paragraphs alone', () => {
		expect(() =>
			mediaPlaceholdersTransformer(state(paragraphWith('{{wiki:media:missing}}')), context)
		).toThrow(/unknown media key "missing"/)
		const out = mediaPlaceholdersTransformer(state(paragraphWith('Plain text.')), context)
		expect((out.root.children as Array<Record<string, unknown>>)[0]?.type).toBe('paragraph')
	})
})
