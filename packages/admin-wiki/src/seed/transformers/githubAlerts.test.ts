import type { SerializedEditorState } from '@payloadcms/richtext-lexical/lexical'
import { describe, expect, it } from 'vitest'

import { githubAlertsTransformer } from './githubAlerts'

const text = (value: string) => ({
	detail: 0,
	format: 0,
	mode: 'normal',
	style: '',
	text: value,
	type: 'text',
	version: 1,
})

const paragraph = (...children: unknown[]) => ({
	children,
	direction: null,
	format: '',
	indent: 0,
	type: 'paragraph',
	version: 1,
})

const state = (...children: unknown[]): SerializedEditorState =>
	({
		root: { children, direction: null, format: '', indent: 0, type: 'root', version: 1 },
	}) as unknown as SerializedEditorState

const context = { guideIdsBySlug: {}, guideTitlesBySlug: {}, media: {} }

describe('githubAlertsTransformer', () => {
	it('rewrites markdown-shaped quotes (inline children) into callout blocks', () => {
		const out = githubAlertsTransformer(
			state({
				children: [text('[!IMPORTANT]'), { type: 'linebreak', version: 1 }, text('Stay sharp.')],
				type: 'quote',
				version: 1,
			}),
			context
		)
		const node = (out.root.children as Array<Record<string, unknown>>)[0]
		expect(node?.type).toBe('block')
		const fields = node?.fields as Record<string, unknown>
		expect(fields.blockType).toBe('wikiCallout')
		expect(fields.variant).toBe('warning')
		const body = fields.body as { root: { children: Array<{ children: Array<{ text: string }> }> } }
		expect(body.root.children).toHaveLength(1)
		expect(body.root.children[0]?.children[0]?.text).toBe('Stay sharp.')
	})

	it('rewrites paragraph-shaped quotes with mapped variants', () => {
		const out = githubAlertsTransformer(
			state({
				children: [paragraph(text('[!WARNING] Mind the gap.'))],
				type: 'quote',
				version: 1,
			}),
			context
		)
		const node = (out.root.children as Array<Record<string, unknown>>)[0]
		expect(node?.type).toBe('block')
		const fields = node?.fields as Record<string, unknown>
		expect(fields.blockType).toBe('wikiCallout')
		expect(fields.variant).toBe('warning')
		const body = fields.body as { root: { children: Array<{ children: Array<{ text: string }> }> } }
		expect(body.root.children[0]?.children[0]?.text).toBe('Mind the gap.')
	})

	it('drops a marker-only first paragraph and keeps the rest as the body', () => {
		const out = githubAlertsTransformer(
			state({
				children: [paragraph(text('[!NOTE]')), paragraph(text('Body line.'))],
				type: 'quote',
				version: 1,
			}),
			context
		)
		const fields = (out.root.children as Array<Record<string, unknown>>)[0]?.fields as Record<
			string,
			unknown
		>
		expect(fields.variant).toBe('info')
		const body = fields.body as { root: { children: Array<{ children: Array<{ text: string }> }> } }
		expect(body.root.children).toHaveLength(1)
		expect(body.root.children[0]?.children[0]?.text).toBe('Body line.')
	})

	it('leaves plain blockquotes and other nodes alone', () => {
		const quote = { children: [paragraph(text('Just a quote.'))], type: 'quote', version: 1 }
		const plain = paragraph(text('Hello'))
		const out = githubAlertsTransformer(state(quote, plain), context)
		const children = out.root.children as Array<Record<string, unknown>>
		expect(children[0]?.type).toBe('quote')
		expect(children[1]?.type).toBe('paragraph')
	})
})
