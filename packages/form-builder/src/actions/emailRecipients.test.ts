import type { PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'
import {
	isFieldToken,
	isPlausibleEmail,
	parseFieldToken,
	resolveRecipients,
	validateRecipients,
} from './emailRecipients'

describe('isPlausibleEmail', () => {
	it('accepts a normal address, rejects junk', () => {
		expect(isPlausibleEmail('a@b.com')).toBe(true)
		expect(isPlausibleEmail(' a@b.com ')).toBe(true)
		expect(isPlausibleEmail('nope')).toBe(false)
		expect(isPlausibleEmail('a@b')).toBe(false)
		expect(isPlausibleEmail('')).toBe(false)
	})
})

describe('parseFieldToken / isFieldToken', () => {
	it('extracts a field name from a token', () => {
		expect(parseFieldToken('{{email}}')).toBe('email')
		expect(parseFieldToken('{{ email }}')).toBe('email')
		expect(parseFieldToken('a@b.com')).toBeUndefined()
		expect(isFieldToken('{{email}}')).toBe(true)
		expect(isFieldToken('a@b.com')).toBe(false)
	})
})

describe('resolveRecipients', () => {
	const resolve = (name: string) => (name === 'email' ? 'user@site.com' : '')

	it('interpolates tokens, passes emails through, drops empties, joins', () => {
		expect(resolveRecipients(['sales@x.com', '{{email}}'], resolve)).toBe(
			'sales@x.com, user@site.com'
		)
		expect(resolveRecipients(['{{missing}}', 'a@b.com'], resolve)).toBe('a@b.com')
		expect(resolveRecipients('legacy@x.com', resolve)).toBe('legacy@x.com')
		expect(resolveRecipients(undefined, resolve)).toBe('')
		expect(resolveRecipients([], resolve)).toBe('')
	})
})

describe('validateRecipients', () => {
	const req = { t: (key: string) => key } as unknown as PayloadRequest
	const data = { fields: [{ blockType: 'email', name: 'email', label: 'Email' }] }
	const validate = validateRecipients(['email'])

	it('passes emails and known tokens; rejects bad emails and unknown tokens', () => {
		expect(validate(['a@b.com', '{{email}}'], { data, req })).toBe(true)
		expect(validate([], { data, req })).toBe(true)
		expect(validate(undefined, { data, req })).toBe(true)
		expect(validate(['nope'], { data, req })).toBe('formBuilder:validation.recipient.invalid')
		expect(validate(['{{missing}}'], { data, req })).toBe(
			'formBuilder:validation.recipient.unknownField'
		)
	})
})
