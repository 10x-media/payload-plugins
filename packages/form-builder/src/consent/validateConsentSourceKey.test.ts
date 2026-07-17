import { describe, expect, it } from 'vitest'
import { validateConsentSourceKey } from './validateConsentSourceKey'

type Args = Parameters<NonNullable<typeof validateConsentSourceKey>>[1]

const t = (key: string) => key

/** Minimal validate args: a document, a path to this key field, and a `req.t`. */
const args = (over: { data?: unknown; path?: (number | string)[]; required?: boolean }): Args =>
	({
		data: over.data,
		path: over.path ?? ['consentSources', 0, 'key'],
		required: over.required ?? true,
		req: { t, payload: { config: {} } },
	}) as unknown as Args

const rows = (...keys: (string | undefined)[]) => ({
	consentSources: keys.map((key) => (key === undefined ? {} : { key })),
})

describe('validateConsentSourceKey', () => {
	it('accepts a key no other row uses', () => {
		expect(validateConsentSourceKey('privacy', args({ data: rows('privacy', 'marketing') }))).toBe(
			true
		)
	})

	it('rejects a key another row already uses', () => {
		expect(
			validateConsentSourceKey(
				'privacy',
				args({ data: rows('privacy', 'privacy'), path: ['consentSources', 1, 'key'] })
			)
		).toBe('formBuilder:consentSources.keyDuplicate')
	})

	it('defers an empty required key to the default required check, not the uniqueness message', () => {
		expect(validateConsentSourceKey('', args({ data: rows('', 'x'), required: true }))).not.toBe(
			'formBuilder:consentSources.keyDuplicate'
		)
	})

	it('finds the array however deep the field is nested', () => {
		expect(
			validateConsentSourceKey(
				'privacy',
				args({
					data: { legal: rows('privacy', 'privacy') },
					path: ['legal', 'consentSources', 0, 'key'],
				})
			)
		).toBe('formBuilder:consentSources.keyDuplicate')
	})

	it('is safe when the document or array branch is missing', () => {
		expect(validateConsentSourceKey('privacy', args({ data: undefined }))).toBe(true)
		expect(validateConsentSourceKey('privacy', args({ data: { consentSources: null } }))).toBe(true)
	})
})
