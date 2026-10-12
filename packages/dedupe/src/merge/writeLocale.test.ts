import { describe, expect, it } from 'vitest'

import { pickWriteLocale } from './writeLocale'

const base = { locales: ['en', 'de', 'uk'], defaultLocale: 'en', requested: undefined }
const completeIn =
	(...locales: string[]) =>
	(locale: string) =>
		locales.includes(locale)

describe('pickWriteLocale', () => {
	it('takes the locale writeLocale answers, complete or not', () => {
		expect(pickWriteLocale({ ...base, requested: 'de', complete: completeIn('en') })).toBe('de')
	})

	it('ignores an answer the config has no locale for', () => {
		expect(pickWriteLocale({ ...base, requested: 'fr', complete: completeIn('en') })).toBe('en')
		expect(pickWriteLocale({ ...base, requested: null, complete: completeIn('en') })).toBe('en')
	})

	it('keeps the default locale where the survivor is complete in it', () => {
		expect(pickWriteLocale({ ...base, complete: completeIn('en', 'de') })).toBe('en')
	})

	it('falls back to the first locale the survivor is complete in', () => {
		expect(pickWriteLocale({ ...base, complete: completeIn('uk', 'de') })).toBe('de')
	})

	it('answers the default locale where the survivor is complete in none', () => {
		expect(pickWriteLocale({ ...base, complete: completeIn() })).toBe('en')
	})
})
