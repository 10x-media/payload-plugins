import { describe, expect, it } from 'vitest'

import { MENTION_NODE_TYPE } from '../editor/mention/constants'
import { bodyToText, disallowedLinks, extractMentions, type LexicalBody, textToBody } from './body'

const paragraph = (...children: object[]) => ({ children, type: 'paragraph', version: 1 })
const text = (value: string) => ({ text: value, type: 'text', version: 1 })
const mention = (userKey: string, label: string) => ({
	label,
	type: MENTION_NODE_TYPE,
	userKey,
	version: 1,
})
const link = (url: string, label: string) => ({
	children: [text(label)],
	fields: { linkType: 'custom', url },
	type: 'link',
	version: 1,
})
const body = (...children: object[]): LexicalBody =>
	({ root: { children, type: 'root', version: 1 } }) as LexicalBody

describe('message bodies', () => {
	it('wraps plain text, lines becoming line breaks', () => {
		const wrapped = textToBody('one\ntwo')
		expect(bodyToText(wrapped)).toBe('one\ntwo')
	})

	it('projects mentions as @Name', () => {
		const value = body(paragraph(text('hi '), mention('users:1', 'Ann'), text('!')))
		expect(bodyToText(value)).toBe('hi @Ann!')
	})

	it('extracts mentions in order, once each', () => {
		const value = body(
			paragraph(mention('users:2', 'Bo'), mention('users:1', 'Ann')),
			paragraph(mention('users:2', 'Bo'))
		)
		expect(extractMentions(value)).toEqual(['users:2', 'users:1'])
	})

	it('allows http, https and mailto links only', () => {
		const value = body(
			paragraph(
				link('https://example.com', 'a'),
				link('mailto:a@b.c', 'b'),
				link('javascript:alert(1)', 'c'),
				link('/relative', 'd'),
				link('HTTP://EXAMPLE.COM', 'e')
			)
		)
		expect(disallowedLinks(value)).toEqual(['javascript:alert(1)', '/relative'])
	})
})
