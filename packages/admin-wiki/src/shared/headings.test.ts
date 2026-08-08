import { describe, expect, it } from 'vitest'

import { collectGuideHeadings, hasTocHeadings, tocHeadings } from './headings'

const heading = (tag: string, text: string) => ({
	children: [{ text, type: 'text' }],
	tag,
	type: 'heading',
})

const doc = (children: unknown[]) => ({ root: { children, type: 'root' } })

describe('collectGuideHeadings', () => {
	it('slugs each heading and records its level', () => {
		const { headings } = collectGuideHeadings(
			doc([
				heading('h2', 'What the editor can do'),
				{ children: [{ text: 'body', type: 'text' }], type: 'paragraph' },
				heading('h3', 'Callouts & blocks'),
			])
		)
		expect(headings).toEqual([
			{ id: 'what-the-editor-can-do', level: 2, text: 'What the editor can do' },
			{ id: 'callouts-blocks', level: 3, text: 'Callouts & blocks' },
		])
	})

	it('joins nested text and suffixes repeated headings', () => {
		const { headings } = collectGuideHeadings(
			doc([
				{
					children: [
						{ text: 'Set ', type: 'text' },
						{ children: [{ text: 'up', type: 'text' }], type: 'link' },
					],
					tag: 'h2',
					type: 'heading',
				},
				heading('h2', 'Set up'),
				heading('h2', 'Set up'),
			])
		)
		expect(headings.map((entry) => entry.id)).toEqual(['set-up', 'set-up-2', 'set-up-3'])
		expect(headings[0]?.text).toBe('Set up')
	})

	it('keys ids by node identity so a renderer can look them up', () => {
		const first = heading('h2', 'Intro')
		const { idsByNode } = collectGuideHeadings(doc([first]))
		expect(idsByNode.get(first)).toBe('intro')
	})

	it('falls back to a stable id for headings with no sluggable text', () => {
		const { headings } = collectGuideHeadings(doc([heading('h2', '???'), heading('h2', '!!!')]))
		expect(headings.map((entry) => entry.id)).toEqual(['section', 'section-2'])
	})

	it('tolerates empty and malformed input', () => {
		expect(collectGuideHeadings(undefined).headings).toEqual([])
		expect(collectGuideHeadings({}).headings).toEqual([])
		expect(collectGuideHeadings({ root: {} }).headings).toEqual([])
	})
})

describe('tocHeadings', () => {
	it('lists h2 and h3 only, and needs three of them to be worth showing', () => {
		const { headings } = collectGuideHeadings(
			doc([
				heading('h1', 'Title'),
				heading('h2', 'One'),
				heading('h3', 'Two'),
				heading('h4', 'Deep'),
			])
		)
		expect(tocHeadings(headings).map((entry) => entry.text)).toEqual(['One', 'Two'])
		expect(hasTocHeadings(headings)).toBe(false)

		const longer = collectGuideHeadings(
			doc([heading('h2', 'One'), heading('h2', 'Two'), heading('h3', 'Three')])
		)
		expect(hasTocHeadings(longer.headings)).toBe(true)
	})
})
