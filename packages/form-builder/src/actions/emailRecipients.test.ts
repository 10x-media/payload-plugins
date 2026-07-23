import type { PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
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

	it('sanitizes each resolved entry to one address: drops header injection and extra recipients', () => {
		const inject = (name: string) =>
			name === 'multi'
				? 'a@b.com, attacker@evil.com'
				: name === 'crlf'
					? 'a@b.com\r\nBcc: x@y.com'
					: ''
		expect(resolveRecipients(['{{multi}}'], inject)).toBe('a@b.com')
		expect(resolveRecipients(['{{crlf}}'], inject)).toBe('a@b.com')
		expect(resolveRecipients(['team@x.com', '{{multi}}'], inject)).toBe('team@x.com, a@b.com')
	})
})

describe('validateRecipients', () => {
	const req = { t: (key: string) => key } as unknown as PayloadRequest
	const data = { fields: [{ blockType: 'email', name: 'email', label: 'Email' }] }

	it('passes emails and known tokens; rejects bad emails and unknown tokens', async () => {
		const validate = validateRecipients({ tokenFieldTypes: ['email'] })
		expect(await validate(['a@b.com', '{{email}}'], { data, req })).toBe(true)
		expect(await validate([], { data, req })).toBe(true)
		expect(await validate(undefined, { data, req })).toBe(true)
		expect(await validate(['nope'], { data, req })).toBe('formBuilder:validation.recipient.invalid')
		expect(await validate(['{{missing}}'], { data, req })).toBe(
			'formBuilder:validation.recipient.unknownField'
		)
	})

	it('does not invoke the options resolver when allowCustom is not false', async () => {
		const resolveAllowed = vi.fn()
		const validate = validateRecipients({ tokenFieldTypes: ['email'], resolveAllowed })
		expect(await validate(['anyone@x.com'], { data, req })).toBe(true)
		expect(resolveAllowed).not.toHaveBeenCalled()
	})

	it('with allowCustom false, accepts a listed member and a token, rejects an off-list email', async () => {
		const resolveAllowed = () => new Set(['sales@x.com'])
		const validate = validateRecipients({
			tokenFieldTypes: ['email'],
			allowCustom: false,
			resolveAllowed,
		})
		expect(await validate(['sales@x.com'], { data, req })).toBe(true)
		expect(await validate(['SALES@X.COM'], { data, req })).toBe(true)
		expect(await validate(['{{email}}'], { data, req })).toBe(true)
		expect(await validate(['stranger@x.com'], { data, req })).toBe(
			'formBuilder:validation.recipient.notAllowed'
		)
	})

	it('with allowCustom false and no resolver, allows only tokens', async () => {
		const validate = validateRecipients({ tokenFieldTypes: ['email'], allowCustom: false })
		expect(await validate(['{{email}}'], { data, req })).toBe(true)
		expect(await validate(['anyone@x.com'], { data, req })).toBe(
			'formBuilder:validation.recipient.notAllowed'
		)
	})

	it('with allowCustom false, fails closed when the resolver throws', async () => {
		const resolveAllowed = () => {
			throw new Error('departments down')
		}
		const validate = validateRecipients({ allowCustom: false, resolveAllowed })
		expect(await validate(['sales@x.com'], { data, req })).toBe(
			'formBuilder:validation.recipient.optionsUnavailable'
		)
	})
})
