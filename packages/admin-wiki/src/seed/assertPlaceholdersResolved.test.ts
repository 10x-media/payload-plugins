import type { SerializedEditorState } from '@payloadcms/richtext-lexical/lexical'
import { describe, expect, it } from 'vitest'

import { assertPlaceholdersResolved } from './assertPlaceholdersResolved'

const text = (value: string, format = 0) => ({ format, text: value, type: 'text', version: 1 })

const paragraphWith = (...children: unknown[]) => ({ children, type: 'paragraph', version: 1 })

const state = (...children: unknown[]): SerializedEditorState =>
	({ root: { children, type: 'root', version: 1 } }) as unknown as SerializedEditorState

describe('assertPlaceholdersResolved', () => {
	it('passes content every transformer resolved', () => {
		expect(() =>
			assertPlaceholdersResolved(state(paragraphWith(text('Nothing left behind.'))), 'a.content')
		).not.toThrow()
	})

	it('throws on a placeholder left as text, naming the guide', () => {
		expect(() =>
			assertPlaceholdersResolved(
				state(paragraphWith(text('See {{wiki:guide:other}} first.'))),
				'a.content'
			)
		).toThrow(/"a\.content" still holds the placeholder \{\{wiki:guide:other\}\}/)
	})

	it('throws on a placeholder left as a link url', () => {
		expect(() =>
			assertPlaceholdersResolved(
				state(
					paragraphWith({
						children: [text('words')],
						fields: { url: '{{wiki:guide:other}}' },
						type: 'link',
						version: 3,
					})
				),
				'a.content'
			)
		).toThrow(/\{\{wiki:guide:other\}\}/)
	})

	it('throws on a placeholder left inside a block field', () => {
		expect(() =>
			assertPlaceholdersResolved(
				state({
					fields: {
						blockType: 'wikiCallout',
						body: {
							root: { children: [paragraphWith(text('{{wiki:media:diagram}}'))], type: 'root' },
						},
					},
					type: 'block',
					version: 2,
				}),
				'a.content'
			)
		).toThrow(/\{\{wiki:media:diagram\}\}/)
	})

	it('leaves inline code alone, so a guide can document the syntax', () => {
		expect(() =>
			assertPlaceholdersResolved(
				state(paragraphWith(text('Write '), text('{{wiki:guide:slug}}', 16))),
				'a.content'
			)
		).not.toThrow()
	})

	it('ignores placeholders outside the namespace the plugin owns', () => {
		expect(() =>
			assertPlaceholdersResolved(
				state(paragraphWith(text('{{embed:https://example.com}}'))),
				'a.content'
			)
		).not.toThrow()
	})
})
