import type { Payload, PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import {
	isFieldToken,
	isPlausibleEmail,
	parseFieldToken,
	resolveRecipientEntries,
	resolveRecipients,
	validateRecipients,
} from './emailRecipients'
import type { RecipientResolveArgs, RecipientSource } from './recipientSources'

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

describe('resolveRecipientEntries', () => {
	const resolve = (name: string) => (name === 'email' ? 'user@site.com' : '')
	const args: RecipientResolveArgs = {
		context: null,
		values: [],
		descriptors: [],
		form: { id: 1 },
		submissionId: 1,
		payload: {} as Payload,
		locale: 'en',
	}
	const source = (
		value: string,
		resolveFn: RecipientSource['resolve']
	): Map<string, RecipientSource> => new Map([[value, { value, label: 'X', resolve: resolveFn }]])

	it('resolves a registered source to its addresses, each through firstAddress', async () => {
		const sources = source('src:x', async () => ['a@x.com, evil@z.com\r\nBcc: y@z.com'])
		expect(await resolveRecipientEntries(['src:x'], { resolve, sources, sourceArgs: args })).toEqual([
			'a@x.com',
		])
	})

	it('splices a source alongside static addresses and field tokens', async () => {
		const sources = source('context:pageContact', async () => ['person@x.com'])
		expect(
			await resolveRecipientEntries(['team@x.com', 'context:pageContact', '{{email}}'], {
				resolve,
				sources,
				sourceArgs: args,
			})
		).toEqual(['team@x.com', 'person@x.com', 'user@site.com'])
	})

	it('drops a source that resolves to [] and keeps the rest', async () => {
		const sources = source('src:empty', async () => [])
		expect(
			await resolveRecipientEntries(['a@b.com', 'src:empty'], { resolve, sources, sourceArgs: args })
		).toEqual(['a@b.com'])
	})

	it('propagates a throwing resolver so the action fails loudly', async () => {
		const sources = source('src:boom', () => {
			throw new Error('nope')
		})
		await expect(
			resolveRecipientEntries(['src:boom'], { resolve, sources, sourceArgs: args })
		).rejects.toThrow('nope')
	})

	it('treats a registered value as a source, never a token or address', async () => {
		const sources = source('context:pageContact', async () => ['person@x.com'])
		expect(
			await resolveRecipientEntries(['context:pageContact'], { resolve, sources, sourceArgs: args })
		).toEqual(['person@x.com'])
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

	it('with fieldTokens false, rejects a {{field}} token but still accepts an email', async () => {
		const validate = validateRecipients({ tokenFieldTypes: ['email'], fieldTokens: false })
		expect(await validate(['a@b.com'], { data, req })).toBe(true)
		expect(await validate(['{{email}}'], { data, req })).toBe(
			'formBuilder:validation.recipient.notAllowed'
		)
	})
})
