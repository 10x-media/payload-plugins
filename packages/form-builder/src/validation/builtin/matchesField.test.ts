import { describe, expect, it } from 'vitest'
import { matchesFieldRule } from './matchesField'

const base = {
	data: {},
	field: { blockType: 'text', name: 'confirm' },
	fieldType: 'text',
	operation: 'create' as const,
	event: 'submit' as const,
	locale: 'en',
	message: () => 'mismatch',
}

describe('matchesFieldRule', () => {
	it('passes when the sibling matches', () => {
		expect(
			matchesFieldRule.validate({
				...base,
				value: 'secret',
				params: { field: 'password' },
				siblingData: { password: 'secret' },
			})
		).toBe(true)
	})
	it('fails when the sibling differs', () => {
		expect(
			matchesFieldRule.validate({
				...base,
				value: 'secret',
				params: { field: 'password' },
				siblingData: { password: 'other' },
			})
		).toBe('mismatch')
	})
})
