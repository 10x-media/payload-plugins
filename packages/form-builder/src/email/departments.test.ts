import type { Payload, PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import {
	type DepartmentOption,
	pickLocaleValue,
	resolveDepartmentOptions,
	resolveDepartmentsRequest,
} from './departments'

const req = { t: (key: string) => key, locale: 'de' } as unknown as PayloadRequest

const makePayload = (localization: unknown): Payload =>
	({ config: { localization } }) as unknown as Payload

const localized = makePayload({ localeCodes: ['en', 'de'], defaultLocale: 'en' })

describe('pickLocaleValue', () => {
	const codes = ['en', 'de']

	it('prefers the current locale', () => {
		expect(pickLocaleValue({ en: 'a', de: 'b' }, 'de', 'en', codes)).toBe('b')
	})

	it('falls back to the default locale when the current is missing', () => {
		expect(pickLocaleValue({ en: 'a' }, 'de', 'en', codes)).toBe('a')
	})

	it('falls back to the next available locale when both current and default are missing', () => {
		expect(pickLocaleValue({ fr: 'c' }, 'de', 'en', ['en', 'de', 'fr'])).toBe('c')
	})

	it('skips an empty current value and continues down the chain', () => {
		expect(pickLocaleValue({ de: '', en: 'a' }, 'de', 'en', codes)).toBe('a')
	})

	it('uses a non-localized bare string as-is', () => {
		expect(pickLocaleValue('support@example.com', 'de', 'en', codes)).toBe('support@example.com')
	})

	it('returns undefined for an empty bare string', () => {
		expect(pickLocaleValue('', 'de', 'en', codes)).toBeUndefined()
	})

	it('returns undefined when nothing resolves', () => {
		expect(pickLocaleValue({}, 'de', 'en', codes)).toBeUndefined()
		expect(pickLocaleValue(undefined, 'de', 'en', codes)).toBeUndefined()
		expect(pickLocaleValue(null, 'de', 'en', codes)).toBeUndefined()
	})
})

describe('resolveDepartmentOptions', () => {
	it('resolves label and email for the requesting locale', () => {
		const doc = {
			departmentEmails: [
				{
					label: { en: 'Sales', de: 'Vertrieb' },
					email: { en: 'sales@example.com', de: 'vertrieb@example.de' },
				},
			],
		}
		expect(resolveDepartmentOptions({ payload: localized, req, doc })).toEqual([
			{ label: 'Vertrieb', value: 'vertrieb@example.de' },
		])
	})

	it('falls back email to the default locale when the current is missing', () => {
		const doc = {
			departmentEmails: [
				{ label: { en: 'Sales', de: 'Vertrieb' }, email: { en: 'sales@example.com' } },
			],
		}
		expect(resolveDepartmentOptions({ payload: localized, req, doc })).toEqual([
			{ label: 'Vertrieb', value: 'sales@example.com' },
		])
	})

	it('resolves the label independently of the email', () => {
		// email resolves to `de`, but the label has only `en`; each subfield walks its own chain.
		const doc = {
			departmentEmails: [
				{ label: { en: 'Sales' }, email: { en: 'sales@example.com', de: 'vertrieb@example.de' } },
			],
		}
		expect(resolveDepartmentOptions({ payload: localized, req, doc })).toEqual([
			{ label: 'Sales', value: 'vertrieb@example.de' },
		])
	})

	it('falls the label back to the email when no label resolves', () => {
		const doc = { departmentEmails: [{ email: { de: 'vertrieb@example.de' } }] }
		expect(resolveDepartmentOptions({ payload: localized, req, doc })).toEqual([
			{ label: 'vertrieb@example.de', value: 'vertrieb@example.de' },
		])
	})

	it('drops an entry with no resolvable email', () => {
		const doc = {
			departmentEmails: [
				{ label: { en: 'Empty' }, email: {} },
				{ label: { en: 'Sales' }, email: { en: 'sales@example.com' } },
			],
		}
		expect(resolveDepartmentOptions({ payload: localized, req, doc })).toEqual([
			{ label: 'Sales', value: 'sales@example.com' },
		])
	})

	it('passes a non-localized bare-string email through (localization disabled)', () => {
		const doc = { departmentEmails: [{ label: 'Support', email: 'support@example.com' }] }
		expect(resolveDepartmentOptions({ payload: makePayload(false), req, doc })).toEqual([
			{ label: 'Support', value: 'support@example.com' },
		])
	})

	it('reads a custom field name', () => {
		const doc = { depts: [{ label: { en: 'Sales' }, email: { en: 'sales@example.com' } }] }
		expect(resolveDepartmentOptions({ payload: localized, req, doc, field: 'depts' })).toEqual([
			{ label: 'Sales', value: 'sales@example.com' },
		])
	})

	it('returns an empty list when the field is missing or not an array', () => {
		expect(resolveDepartmentOptions({ payload: localized, req, doc: {} })).toEqual([])
		expect(
			resolveDepartmentOptions({ payload: localized, req, doc: { departmentEmails: 'nope' } })
		).toEqual([])
	})
})

const options: DepartmentOption[] = [
	{ label: 'Sales', value: 'sales@example.com' },
	{ label: 'Support', value: 'support@example.com' },
]

describe('resolveDepartmentsRequest', () => {
	it('refuses anonymous callers without invoking the resolver', async () => {
		const resolver = vi.fn()
		const result = await resolveDepartmentsRequest({ isAuthed: false, req, resolver })
		expect(result.status).toBe(403)
		expect(resolver).not.toHaveBeenCalled()
	})

	it('serves the resolver options to authed callers', async () => {
		const result = await resolveDepartmentsRequest({ isAuthed: true, req, resolver: () => options })
		expect(result.status).toBe(200)
		expect('options' in result.body ? result.body.options : []).toEqual(options)
	})

	it('passes req through to the resolver', async () => {
		const resolver = vi.fn().mockResolvedValue(options)
		await resolveDepartmentsRequest({ isAuthed: true, req, resolver })
		expect(resolver).toHaveBeenCalledWith({ req })
	})

	it('fails closed (503) when the resolver throws', async () => {
		const result = await resolveDepartmentsRequest({
			isAuthed: true,
			req,
			resolver: () => {
				throw new Error('boom')
			},
		})
		expect(result.status).toBe(503)
		expect('errors' in result.body).toBe(true)
	})
})
