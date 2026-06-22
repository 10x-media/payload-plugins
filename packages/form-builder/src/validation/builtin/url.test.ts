import { describe, expect, it } from 'vitest'
import { urlRule } from './url'

const ctx = {
	siblingData: {},
	data: {},
	field: { blockType: 'text', name: 'u' },
	fieldType: 'text',
	operation: 'create' as const,
	event: 'submit' as const,
	locale: 'en',
	message: () => 'bad',
	params: {},
}

describe('urlRule', () => {
	it('accepts an http(s) URL and empty', () => {
		expect(urlRule.validate({ ...ctx, value: 'https://x.com' })).toBe(true)
		expect(urlRule.validate({ ...ctx, value: '' })).toBe(true)
	})
	it('rejects a non-URL', () => {
		expect(urlRule.validate({ ...ctx, value: 'nope' })).toBe('bad')
	})
})
