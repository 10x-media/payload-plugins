import { describe, expect, it } from 'vitest'
import { emailRule } from './email'

const ctx = {
	siblingData: {},
	data: {},
	field: { blockType: 'text', name: 'e' },
	fieldType: 'text',
	operation: 'create' as const,
	event: 'submit' as const,
	locale: 'en',
	message: () => 'bad',
	params: {},
}

describe('emailRule', () => {
	it('accepts a valid email and empty', () => {
		expect(emailRule.validate({ ...ctx, value: 'a@b.com' })).toBe(true)
		expect(emailRule.validate({ ...ctx, value: '' })).toBe(true)
	})
	it('rejects an invalid email', () => {
		expect(emailRule.validate({ ...ctx, value: 'nope' })).toBe('bad')
	})
})
