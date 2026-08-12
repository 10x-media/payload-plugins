import { describe, expect, it } from 'vitest'

import { resolveReaderLocale } from './resolveLocale'

const base = { contentLocales: ['en', 'de'], defaultLocale: 'en', localeMap: {} }

describe('resolveReaderLocale', () => {
	it('returns undefined for non-localized projects', () => {
		expect(resolveReaderLocale({ ...base, contentLocales: [], language: 'de' })).toBeUndefined()
	})

	it('maps admin language through the localeMap first', () => {
		expect(resolveReaderLocale({ ...base, language: 'uk', localeMap: { uk: 'de' } })).toBe('de')
	})

	it('uses the language directly when it is a content locale', () => {
		expect(resolveReaderLocale({ ...base, language: 'de' })).toBe('de')
	})

	it('ignores a localeMap entry pointing at an unknown locale', () => {
		expect(resolveReaderLocale({ ...base, language: 'uk', localeMap: { uk: 'es' } })).toBe('en')
	})

	it('falls back to the default locale', () => {
		expect(resolveReaderLocale({ ...base, language: 'es' })).toBe('en')
		expect(resolveReaderLocale({ ...base, language: undefined })).toBe('en')
	})
})
