import { describe, expect, it } from 'vitest'
import type { BodyRender } from './converters'
import { serializeSlate } from './serializeSlate'

const passthrough: BodyRender = {
	text: (raw) => raw,
	interpolate: (raw) => raw,
}

describe('serializeSlate', () => {
	it('renders paragraphs with text leaves', () => {
		const nodes = [{ children: [{ text: 'Hello' }] }]
		expect(serializeSlate(nodes, passthrough)).toBe('<p>Hello</p>')
	})

	it('applies bold, italic, underline, and code marks', () => {
		const nodes = [
			{
				children: [
					{ text: 'b', bold: true },
					{ text: 'i', italic: true },
					{ text: 'u', underline: true },
					{ text: 'c', code: true },
				],
			},
		]
		expect(serializeSlate(nodes, passthrough)).toBe(
			'<p><strong>b</strong><em>i</em><u>u</u><code>c</code></p>'
		)
	})

	it('runs leaf text through the render pipeline', () => {
		const render: BodyRender = { text: (raw) => `[${raw}]`, interpolate: (raw) => raw }
		expect(serializeSlate([{ children: [{ text: 'x' }] }], render)).toBe('<p>[x]</p>')
	})

	it('renders links through sanitizeUrl with interpolated hrefs', () => {
		const render: BodyRender = {
			text: (raw) => raw,
			interpolate: (raw) => raw.replace('{{id}}', '7'),
		}
		const nodes = [
			{
				children: [
					{ type: 'link', url: 'https://x.com/{{id}}', children: [{ text: 'go' }] },
					{ type: 'link', url: 'javascript:alert(1)', children: [{ text: 'bad' }] },
				],
			},
		]
		expect(serializeSlate(nodes, render)).toBe(
			'<p><a href="https://x.com/7">go</a><a href="#">bad</a></p>'
		)
	})

	it('ignores non-object nodes', () => {
		expect(serializeSlate([null, 42, 'x'], passthrough)).toBe('')
	})
})
