import { describe, expect, it } from 'vitest'

import { hasContent, toEditorJSON, toStoredJSON } from './json'

const text = (value: string) => ({ text: value, type: 'text', version: 1 })
const doc = (...children: unknown[]) => ({
	root: { children: [{ children, type: 'paragraph', version: 1 }], type: 'root', version: 1 },
})

const storedLink = {
	children: [text('docs')],
	fields: { linkType: 'custom', newTab: true, url: 'https://example.com' },
	id: '65f0c0ffee',
	type: 'link',
	version: 3,
}

describe('composer json', () => {
	it('maps a stored link to the composer shape', () => {
		const state = toEditorJSON(doc(text('see '), storedLink)) as ReturnType<typeof doc>
		const link = state.root.children[0]?.children[1]
		expect(link).toEqual({
			children: [text('docs')],
			rel: 'noopener noreferrer',
			target: '_blank',
			title: null,
			type: 'link',
			url: 'https://example.com',
			version: 1,
		})
	})

	it('maps a composer link back to Payload fields', () => {
		const composer = {
			children: [text('docs')],
			rel: null,
			target: null,
			title: null,
			type: 'link',
			url: 'mailto:a@b.c',
			version: 1,
		}
		const stored = toStoredJSON(doc(composer)) as ReturnType<typeof doc>
		expect(stored.root.children[0]?.children[0]).toEqual({
			children: [text('docs')],
			fields: { linkType: 'custom', newTab: false, url: 'mailto:a@b.c' },
			type: 'link',
			version: 3,
		})
	})

	it('round-trips autolinks with their own version', () => {
		const composer = {
			children: [text('https://x.dev')],
			isUnlinked: false,
			rel: 'noopener noreferrer',
			target: '_blank',
			title: null,
			type: 'autolink',
			url: 'https://x.dev',
			version: 1,
		}
		const stored = toStoredJSON(doc(composer)) as ReturnType<typeof doc>
		expect(stored.root.children[0]?.children[0]).toMatchObject({
			fields: { newTab: true, url: 'https://x.dev' },
			type: 'autolink',
			version: 2,
		})
		const back = toEditorJSON(stored) as ReturnType<typeof doc>
		expect(back.root.children[0]?.children[0]).toEqual(composer)
	})

	it('leaves other nodes and empty bodies alone', () => {
		const body = doc(text('plain'))
		expect(toStoredJSON(toEditorJSON(body))).toEqual(body)
		expect(toEditorJSON(null)).toBeNull()
	})

	it('knows an empty body from one with content', () => {
		expect(hasContent(doc(text('   ')))).toBe(false)
		expect(hasContent(doc(text(' hi ')))).toBe(true)
		expect(hasContent(doc({ label: 'A', type: 'conversationsMention', userKey: 'users:1' }))).toBe(
			true
		)
		expect(hasContent(undefined)).toBe(false)
	})
})
