import { describe, expect, it } from 'vitest'
import { textOfBody } from './textOfBody'

const lexical = (children: unknown[]) => ({ root: { type: 'root', children } })
const paragraph = (children: unknown[]) => ({ type: 'paragraph', children })
const t = (text: string, extra: Record<string, unknown> = {}) => ({ type: 'text', text, ...extra })
const link = (children: unknown[], url = 'https://example.com') => ({
	type: 'link',
	fields: { url },
	children,
})

describe('textOfBody', () => {
	it('returns a plain string as-is', () => {
		expect(textOfBody('I agree to the terms')).toBe('I agree to the terms')
	})

	it('returns an empty string for an empty string', () => {
		expect(textOfBody('')).toBe('')
	})

	it('concatenates lexical text nodes across a paragraph', () => {
		const body = lexical([paragraph([t('I agree to the '), t('terms')])])
		expect(textOfBody(body)).toBe('I agree to the terms')
	})

	it('flattens an inline lexical link node into its child text', () => {
		const body = lexical([paragraph([t('I agree to the '), link([t('Privacy Policy')]), t('.')])])
		expect(textOfBody(body)).toBe('I agree to the Privacy Policy.')
	})

	it('joins sibling paragraphs with a single space', () => {
		const body = lexical([paragraph([t('First')]), paragraph([t('Second')])])
		expect(textOfBody(body)).toBe('First Second')
	})

	it('joins heading, list items, and quote with single spaces', () => {
		const body = lexical([
			{ type: 'heading', tag: 'h2', children: [t('Important Terms')] },
			{
				type: 'list',
				tag: 'ul',
				children: [
					{ type: 'listitem', children: [t('Option A')] },
					{ type: 'listitem', children: [t('Option B')] },
				],
			},
			{ type: 'quote', children: [t('Quoted')] },
		])
		expect(textOfBody(body)).toBe('Important Terms Option A Option B Quoted')
	})

	it('produces no leading, trailing, or doubled spaces around empty blocks', () => {
		const body = lexical([paragraph([]), paragraph([t('Only')]), paragraph([t(' ')])])
		expect(textOfBody(body)).toBe('Only')
	})

	it('flattens a legacy slate array, including an inline link element', () => {
		const body = [
			{
				type: 'paragraph',
				children: [
					{ text: 'I agree to the ' },
					{ type: 'link', url: 'https://example.com', children: [{ text: 'terms' }] },
				],
			},
		]
		expect(textOfBody(body)).toBe('I agree to the terms')
	})

	it('handles a bare slate leaf array', () => {
		expect(textOfBody([{ text: 'Hi ' }, { text: 'there' }])).toBe('Hi there')
	})

	it('returns an empty string for null and undefined', () => {
		expect(textOfBody(null)).toBe('')
		expect(textOfBody(undefined)).toBe('')
	})

	it('returns an empty string for non-body primitives', () => {
		expect(textOfBody(42)).toBe('')
		expect(textOfBody(true)).toBe('')
	})

	it('returns an empty string for an object with no root', () => {
		expect(textOfBody({ foo: 'bar' })).toBe('')
	})

	it('returns an empty string when root.children is missing or malformed', () => {
		expect(textOfBody({ root: {} })).toBe('')
		expect(textOfBody({ root: { children: 'not-an-array' } })).toBe('')
		expect(textOfBody({ root: null })).toBe('')
	})

	it('never throws on garbage nodes mixed into an array', () => {
		expect(textOfBody([1, 'str', null, undefined, { text: 5 }, { children: null }])).toBe('')
	})

	it('ignores nodes without a children array and without text', () => {
		const body = lexical([{ type: 'horizontalrule' }, paragraph([t('after')])])
		expect(textOfBody(body)).toBe('after')
	})
})
