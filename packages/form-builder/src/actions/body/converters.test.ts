import { describe, expect, it } from 'vitest'
import type { BodyRender } from './converters'
import { defaultBodyConverters, sanitizeUrl } from './converters'

const passthrough: BodyRender = {
	text: (raw) => raw,
	interpolate: (raw) => raw,
}

const convert = (type: string, node: Record<string, unknown>, children = '') => {
	const converter = defaultBodyConverters[type]
	if (!converter) {
		throw new Error(`no converter for ${type}`)
	}
	return converter({ node: { type, ...node }, children, render: passthrough })
}

describe('sanitizeUrl', () => {
	it('allows http, https, mailto, tel', () => {
		expect(sanitizeUrl('https://example.com')).toBe('https://example.com')
		expect(sanitizeUrl('http://example.com')).toBe('http://example.com')
		expect(sanitizeUrl('mailto:a@b.com')).toBe('mailto:a@b.com')
		expect(sanitizeUrl('tel:+491234')).toBe('tel:+491234')
	})

	it('allows relative URLs', () => {
		expect(sanitizeUrl('/contact')).toBe('/contact')
		expect(sanitizeUrl('#section')).toBe('#section')
		expect(sanitizeUrl('../up')).toBe('../up')
	})

	it('rejects javascript: and data: URLs', () => {
		expect(sanitizeUrl('javascript:alert(1)')).toBe('#')
		expect(sanitizeUrl('data:text/html,x')).toBe('#')
	})

	it('rejects scheme smuggling via embedded whitespace', () => {
		expect(sanitizeUrl('java\nscript:alert(1)')).toBe('#')
		expect(sanitizeUrl(' javascript:alert(1)')).toBe('#')
	})

	it('turns an empty URL into #', () => {
		expect(sanitizeUrl('')).toBe('#')
	})
})

describe('defaultBodyConverters', () => {
	it('renders a paragraph', () => {
		expect(convert('paragraph', {}, 'hi')).toBe('<p>hi</p>')
	})

	it('renders a linebreak and a horizontal rule', () => {
		expect(convert('linebreak', {})).toBe('<br />')
		expect(convert('horizontalrule', {})).toBe('<hr />')
	})

	it('renders text through the render pipeline', () => {
		const render: BodyRender = { text: (raw) => `[${raw}]`, interpolate: (raw) => raw }
		const converter = defaultBodyConverters.text
		expect(converter?.({ node: { type: 'text', text: 'hi' }, children: '', render })).toBe('[hi]')
	})

	it('applies the lexical format bitmask', () => {
		const textOf = (format: number) =>
			defaultBodyConverters.text?.({
				node: { type: 'text', text: 'x', format },
				children: '',
				render: passthrough,
			})
		expect(textOf(1)).toBe('<strong>x</strong>')
		expect(textOf(2)).toBe('<em>x</em>')
		expect(textOf(4)).toBe('<s>x</s>')
		expect(textOf(8)).toBe('<u>x</u>')
		expect(textOf(16)).toBe('<code>x</code>')
		expect(textOf(3)).toBe('<em><strong>x</strong></em>')
	})

	it('renders links with sanitized, escaped hrefs', () => {
		expect(convert('link', { fields: { url: 'https://x.com/?a=1&b=2' } }, 'go')).toBe(
			'<a href="https://x.com/?a=1&amp;b=2">go</a>'
		)
		expect(convert('link', { fields: { url: 'javascript:alert(1)' } }, 'go')).toBe(
			'<a href="#">go</a>'
		)
	})

	it('interpolates tokens in hrefs before sanitizing', () => {
		const render: BodyRender = {
			text: (raw) => raw,
			interpolate: (raw) => raw.replace('{{id}}', '42'),
		}
		const converter = defaultBodyConverters.link
		expect(
			converter?.({
				node: { type: 'link', fields: { url: 'https://x.com/{{id}}' } },
				children: 'go',
				render,
			})
		).toBe('<a href="https://x.com/42">go</a>')
	})

	it('adds target and rel for newTab links', () => {
		expect(convert('link', { fields: { url: 'https://x.com', newTab: true } }, 'go')).toBe(
			'<a href="https://x.com" rel="noopener noreferrer" target="_blank">go</a>'
		)
	})

	it('renders autolinks like links, reading a top-level url too', () => {
		expect(convert('autolink', { url: 'https://x.com' }, 'x')).toBe('<a href="https://x.com">x</a>')
	})

	it('renders headings and clamps unknown tags', () => {
		expect(convert('heading', { tag: 'h3' }, 'title')).toBe('<h3>title</h3>')
		expect(convert('heading', { tag: 'h9' }, 'title')).toBe('<h2>title</h2>')
		expect(convert('heading', {}, 'title')).toBe('<h2>title</h2>')
	})

	it('renders quotes, lists, and list items', () => {
		expect(convert('quote', {}, 'q')).toBe('<blockquote>q</blockquote>')
		expect(convert('list', { listType: 'number' }, '<li>a</li>')).toBe('<ol><li>a</li></ol>')
		expect(convert('list', { tag: 'ul' }, '<li>a</li>')).toBe('<ul><li>a</li></ul>')
		expect(convert('list', {}, '<li>a</li>')).toBe('<ul><li>a</li></ul>')
		expect(convert('listitem', {}, 'a')).toBe('<li>a</li>')
	})
})
