import { describe, expect, it } from 'vitest'
import type { SubmissionDescriptor, SubmissionValue } from '../../submissions/types'
import { makeRenderBody, serializeBody } from './serializeBody'

const values: SubmissionValue[] = [
	{ field: 'name', value: 'A & B' },
	{ field: 'email', value: 'a@b.com' },
]

const descriptors: SubmissionDescriptor[] = [
	{ field: 'name', label: 'Name', fieldType: 'text' },
	{ field: 'email', label: 'Email', fieldType: 'email' },
]

const ctx = { values, descriptors }

const lexical = (children: unknown[]) => ({ root: { type: 'root', children } })
const paragraph = (text: string, extra: Record<string, unknown> = {}) => ({
	type: 'paragraph',
	children: [{ type: 'text', text, ...extra }],
})

describe('serializeBody', () => {
	it('keeps legacy string bodies interpolated and unescaped', () => {
		expect(serializeBody('Hi {{name}}, <b>thanks</b>', ctx)).toBe('Hi A & B, <b>thanks</b>')
	})

	it('serializes a lexical paragraph with escaped interpolated values', () => {
		expect(serializeBody(lexical([paragraph('Hello {{name}}')]), ctx)).toBe(
			'<p>Hello A &amp; B</p>'
		)
	})

	it('escapes literal HTML typed into lexical text', () => {
		expect(serializeBody(lexical([paragraph('<script>x</script>')]), ctx)).toBe(
			'<p>&lt;script&gt;x&lt;/script&gt;</p>'
		)
	})

	it('substitutes token fallbacks for missing values', () => {
		expect(serializeBody(lexical([paragraph('Hi {{missing|friend}}')]), ctx)).toBe(
			'<p>Hi friend</p>'
		)
	})

	it('expands {{*}} into all answers as lines', () => {
		expect(serializeBody(lexical([paragraph('{{*}}')]), ctx)).toBe(
			'<p>Name: A &amp; B<br />Email: a@b.com</p>'
		)
	})

	it('expands {{*:table}} into all answers as a table', () => {
		const out = serializeBody(lexical([paragraph('{{*:table}}')]), ctx)
		expect(out).toBe(
			'<p><table><tbody><tr><td>Name</td><td>A &amp; B</td></tr><tr><td>Email</td><td>a@b.com</td></tr></tbody></table></p>'
		)
	})

	it('renders children of unknown lexical node types', () => {
		const body = lexical([{ type: 'mystery', children: [paragraph('inside')] }])
		expect(serializeBody(body, ctx)).toBe('<p>inside</p>')
	})

	it('lets custom converters override defaults per node type', () => {
		const out = serializeBody(lexical([paragraph('x')]), {
			...ctx,
			converters: { paragraph: ({ children }) => `<div>${children}</div>` },
		})
		expect(out).toBe('<div>x</div>')
	})

	it('serializes a slate array body', () => {
		const out = serializeBody([{ children: [{ text: 'Hi {{name}}', bold: true }] }], ctx)
		expect(out).toBe('<p><strong>Hi A &amp; B</strong></p>')
	})

	it('returns an empty string for null, undefined, and non-body objects', () => {
		expect(serializeBody(null, ctx)).toBe('')
		expect(serializeBody(undefined, ctx)).toBe('')
		expect(serializeBody({ foo: 'bar' }, ctx)).toBe('')
		expect(serializeBody(42, ctx)).toBe('')
	})
})

describe('makeRenderBody', () => {
	it('renders through the default pipeline', async () => {
		const renderBody = makeRenderBody({ values, descriptors })
		await expect(renderBody(lexical([paragraph('Hello {{name}}')]))).resolves.toBe(
			'<p>Hello A &amp; B</p>'
		)
	})

	it('passes converter overrides through', async () => {
		const renderBody = makeRenderBody({
			values,
			descriptors,
			richText: { converters: { paragraph: ({ children }) => `<section>${children}</section>` } },
		})
		await expect(renderBody(lexical([paragraph('x')]))).resolves.toBe('<section>x</section>')
	})

	it('lets a custom serialize replace the pipeline entirely', async () => {
		const renderBody = makeRenderBody({
			values,
			descriptors,
			richText: {
				serialize: ({ body, values: v }) => `custom:${typeof body}:${v.length}`,
			},
		})
		await expect(renderBody(lexical([]))).resolves.toBe('custom:object:2')
	})
})
